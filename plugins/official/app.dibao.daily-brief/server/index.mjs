const PLUGIN_ID = "app.dibao.daily-brief";
const TASK_ID = "dailyBrief.generate";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = {
  enabled: true,
  scheduledLocalTime: "08:00",
  timezone: "UTC",
  articleCount: 20,
  excludedFamilyIds: [],
  excludedClusterIds: []
};
const SUMMARY_MAX_LENGTH = 280;

export default {
  activate(ctx) {
    ensureSchedule(ctx);

    ctx.hooks.on("maintenance.tick", () => {
      ensureSchedule(ctx);
    });

    ctx.tasks.register(TASK_ID, async () => {
      const settings = readSettings(ctx);
      if (!settings.enabled) {
        return;
      }
      await generateBrief(ctx, settings);
    });

    ctx.api.get("/state", () => {
      const settings = readSettings(ctx);
      ensureSchedule(ctx, settings);
      return {
        settings,
        targets: readTargets(ctx),
        briefs: listBriefs(ctx),
        latest: latestBrief(ctx),
        generatedAt: ctx.now()
      };
    });

    ctx.api.post("/settings", ({ body }) => {
      const next = sanitizeSettings(body, readSettings(ctx));
      writeSettings(ctx, next);
      ensureSchedule(ctx, next);
      return {
        settings: next,
        targets: readTargets(ctx),
        briefs: listBriefs(ctx),
        latest: latestBrief(ctx)
      };
    });

    ctx.api.post("/generate", async ({ body }) => {
      const settings = readSettings(ctx);
      const force = body && typeof body === "object" && body.force === true;
      const hadTodayBrief = Boolean(ctx.storage.get(briefKey(ctx.now(), settings.timezone)));
      const brief = await generateBrief(ctx, settings, { force });
      return {
        brief,
        briefs: listBriefs(ctx),
        generated: force || !hadTodayBrief
      };
    });
  }
};

function readSettings(ctx) {
  return {
    enabled: readBoolean(ctx.settings.get("enabled"), DEFAULT_SETTINGS.enabled),
    scheduledLocalTime: readLocalTime(ctx.settings.get("scheduledLocalTime"), DEFAULT_SETTINGS.scheduledLocalTime),
    timezone: readString(ctx.settings.get("timezone"), DEFAULT_SETTINGS.timezone),
    articleCount: readInteger(ctx.settings.get("articleCount"), 5, 50, DEFAULT_SETTINGS.articleCount),
    excludedFamilyIds: readStringArray(ctx.settings.get("excludedFamilyIds")),
    excludedClusterIds: readStringArray(ctx.settings.get("excludedClusterIds"))
  };
}

function writeSettings(ctx, settings) {
  ctx.settings.set("enabled", settings.enabled);
  ctx.settings.set("scheduledLocalTime", settings.scheduledLocalTime);
  ctx.settings.set("timezone", settings.timezone);
  ctx.settings.set("articleCount", settings.articleCount);
  ctx.settings.set("excludedFamilyIds", settings.excludedFamilyIds);
  ctx.settings.set("excludedClusterIds", settings.excludedClusterIds);
}

function ensureSchedule(ctx, settings = readSettings(ctx)) {
  ctx.scheduler.configureDaily(TASK_ID, {
    enabled: settings.enabled,
    localTime: settings.scheduledLocalTime,
    timezone: settings.timezone
  });
}

async function generateBrief(ctx, settings, options = {}) {
  const now = ctx.now();
  const key = briefKey(now, settings.timezone);
  const existing = ctx.storage.get(key);
  if (existing && options.force !== true) {
    return existing;
  }

  const candidates = ctx.ranking.listRankedWinners({
    windowMs: DAY_MS,
    limit: Math.max(settings.articleCount * 5, 50)
  });
  const filtered = filterCandidates(candidates, settings);
  const selected = diversifyByFamily(filtered, settings.articleCount).map((article) => briefArticle(article, now));
  const groups = groupByFamily(selected);
  const brief = {
    id: key.replace("brief:", ""),
    pluginId: PLUGIN_ID,
    generatedAt: now,
    windowStartAt: now - DAY_MS,
    windowEndAt: now,
    timezone: settings.timezone,
    articleCount: selected.length,
    emptyReason: selected.length === 0 ? "no_articles_for_settings" : null,
    groups
  };

  ctx.storage.set(key, brief);
  pruneBriefs(ctx);
  return brief;
}

function readTargets(ctx) {
  return typeof ctx.ranking.listTopicTargets === "function"
    ? ctx.ranking.listTopicTargets()
    : { families: [], clusters: [] };
}

function filterCandidates(candidates, settings) {
  const excludedFamilies = new Set(settings.excludedFamilyIds);
  const excludedClusters = new Set(settings.excludedClusterIds);
  return candidates.filter((candidate) => {
    const familyId = candidate.familyId || `source:${candidate.feedId}`;
    if (excludedFamilies.has(familyId)) {
      return false;
    }
    if (candidate.clusterId && excludedClusters.has(candidate.clusterId)) {
      return false;
    }
    return true;
  });
}

function briefArticle(article, now) {
  return {
    articleId: article.articleId,
    feedId: article.feedId,
    feedTitle: article.feedTitle,
    title: article.title,
    url: article.url,
    summary: article.summary,
    displaySummary: cleanSummary(article.summary, SUMMARY_MAX_LENGTH),
    publishedAt: article.publishedAt,
    discoveredAt: article.discoveredAt,
    score: article.score,
    calculatedAt: article.calculatedAt,
    familyId: article.familyId,
    familyLabel: article.familyLabel,
    clusterId: article.clusterId,
    clusterLabel: article.clusterLabel,
    reason: article.reason,
    snapshotAt: now
  };
}

function listBriefs(ctx) {
  return ctx.storage
    .listByPrefix("brief:")
    .map((item) => item.value)
    .sort((left, right) => right.generatedAt - left.generatedAt)
    .slice(0, 30);
}

function latestBrief(ctx) {
  return listBriefs(ctx)[0] ?? null;
}

function pruneBriefs(ctx) {
  const rows = ctx.storage
    .listByPrefix("brief:")
    .sort((left, right) => right.value.generatedAt - left.value.generatedAt);
  for (const row of rows.slice(30)) {
    ctx.storage.delete(row.key);
  }
}

function diversifyByFamily(candidates, limit) {
  const families = new Map();
  for (const candidate of candidates) {
    const key = candidate.familyId || `source:${candidate.feedId}`;
    const list = families.get(key) ?? [];
    list.push(candidate);
    families.set(key, list);
  }
  const selected = [];
  const maxPerFamily = Math.max(2, Math.ceil(limit / Math.max(families.size, 1)));
  let changed = true;
  while (selected.length < limit && changed) {
    changed = false;
    for (const [familyId, list] of families.entries()) {
      if (selected.length >= limit) {
        break;
      }
      const familySelected = selected.filter((item) => (item.familyId || `source:${item.feedId}`) === familyId).length;
      if (familySelected >= maxPerFamily) {
        continue;
      }
      const next = list.shift();
      if (next) {
        selected.push(next);
        changed = true;
      }
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) {
      break;
    }
    if (!selected.some((item) => item.articleId === candidate.articleId)) {
      selected.push(candidate);
    }
  }
  return selected;
}

function groupByFamily(articles) {
  const groups = [];
  const byFamily = new Map();
  for (const article of articles) {
    const familyId = article.familyId || `source:${article.feedId}`;
    const group = byFamily.get(familyId) ?? {
      id: familyId,
      label: article.familyLabel || article.feedTitle || "未分组",
      articles: []
    };
    group.articles.push(article);
    byFamily.set(familyId, group);
  }
  for (const group of byFamily.values()) {
    groups.push(group);
  }
  return groups;
}

function briefKey(now, timezone) {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(now));
  return `brief:${dateKey}`;
}

function sanitizeSettings(input, current) {
  const object = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    enabled: readBoolean(object.enabled, current.enabled),
    scheduledLocalTime: readLocalTime(object.scheduledLocalTime, current.scheduledLocalTime),
    timezone: readString(object.timezone, current.timezone),
    articleCount: readInteger(object.articleCount, 5, 50, current.articleCount),
    excludedFamilyIds: readStringArray(object.excludedFamilyIds, current.excludedFamilyIds),
    excludedClusterIds: readStringArray(object.excludedClusterIds, current.excludedClusterIds)
  };
}

function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readLocalTime(value, fallback) {
  const normalized = readString(value, fallback);
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : fallback;
}

function readInteger(value, min, max, fallback) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function readStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return Array.from(new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))).sort();
}

function cleanSummary(value, maxLength) {
  const text = htmlToText(value);
  if (!text) {
    return null;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function htmlToText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|ul|ol|blockquote|br)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = String(entity).toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[lower] ?? match;
  });
}
