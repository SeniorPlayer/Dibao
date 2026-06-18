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
  async activate(ctx) {
    ctx.hooks.on("maintenance.tick", async () => {
      await ensureSchedule(ctx);
    });

    ctx.tasks.register(TASK_ID, async () => {
      const settings = await readSettings(ctx);
      if (!settings.enabled) {
        return;
      }
      await generateBrief(ctx, settings);
    });

    ctx.api.get("/state", async () => {
      const settings = await readSettings(ctx);
      const targets = await readTargets(ctx);
      const briefs = await listBriefs(ctx, targets);
      return {
        settings,
        targets,
        briefs,
        latest: latestFromBriefs(briefs),
        generatedAt: await ctx.now()
      };
    });

    ctx.api.get("/briefs", async () => {
      const briefs = await listBriefs(ctx);
      return {
        briefs,
        latest: latestFromBriefs(briefs),
        generatedAt: await ctx.now()
      };
    });

    ctx.api.post("/settings", async ({ body }) => {
      const next = sanitizeSettings(body, await readSettings(ctx));
      await writeSettings(ctx, next);
      await ensureSchedule(ctx, next);
      const targets = await readTargets(ctx);
      const briefs = await listBriefs(ctx, targets);
      return {
        settings: next,
        targets,
        briefs,
        latest: latestFromBriefs(briefs)
      };
    });

    ctx.api.post("/generate", async ({ body }) => {
      const settings = await readSettings(ctx);
      const force = body && typeof body === "object" && body.force === true;
      const now = await ctx.now();
      const hadTodayBrief = Boolean(await ctx.storage.get(briefKey(now, settings.timezone)));
      const brief = await generateBrief(ctx, settings, { force });
      const targets = await readTargets(ctx);
      const briefs = await listBriefs(ctx, targets);
      return {
        brief: hydrateBriefLabels(brief, targets),
        briefs,
        generated: force || !hadTodayBrief
      };
    });

    void ensureSchedule(ctx).catch(() => {
      // Activation must stay quick; maintenance.tick and settings saves retry schedule sync.
    });
  }
};

async function readSettings(ctx) {
  const [
    enabled,
    scheduledLocalTime,
    timezone,
    articleCount,
    excludedFamilyIds,
    excludedClusterIds
  ] = await Promise.all([
    ctx.settings.get("enabled"),
    ctx.settings.get("scheduledLocalTime"),
    ctx.settings.get("timezone"),
    ctx.settings.get("articleCount"),
    ctx.settings.get("excludedFamilyIds"),
    ctx.settings.get("excludedClusterIds")
  ]);
  return {
    enabled: readBoolean(enabled, DEFAULT_SETTINGS.enabled),
    scheduledLocalTime: readLocalTime(scheduledLocalTime, DEFAULT_SETTINGS.scheduledLocalTime),
    timezone: readString(timezone, DEFAULT_SETTINGS.timezone),
    articleCount: readInteger(articleCount, 5, 50, DEFAULT_SETTINGS.articleCount),
    excludedFamilyIds: readStringArray(excludedFamilyIds),
    excludedClusterIds: readStringArray(excludedClusterIds)
  };
}

async function writeSettings(ctx, settings) {
  await Promise.all([
    ctx.settings.set("enabled", settings.enabled),
    ctx.settings.set("scheduledLocalTime", settings.scheduledLocalTime),
    ctx.settings.set("timezone", settings.timezone),
    ctx.settings.set("articleCount", settings.articleCount),
    ctx.settings.set("excludedFamilyIds", settings.excludedFamilyIds),
    ctx.settings.set("excludedClusterIds", settings.excludedClusterIds)
  ]);
}

async function ensureSchedule(ctx, settings) {
  const resolvedSettings = settings ?? await readSettings(ctx);
  await ctx.scheduler.configureDaily(TASK_ID, {
    enabled: resolvedSettings.enabled,
    localTime: resolvedSettings.scheduledLocalTime,
    timezone: resolvedSettings.timezone
  });
}

async function generateBrief(ctx, settings, options = {}) {
  const now = await ctx.now();
  const key = briefKey(now, settings.timezone);
  const existing = await ctx.storage.get(key);
  if (existing && options.force !== true) {
    return existing;
  }

  const candidates = await ctx.ranking.listRankedWinners({
    windowMs: DAY_MS,
    limit: Math.max(settings.articleCount * 5, 50)
  });
  const windowStartAt = now - DAY_MS;
  const windowEndAt = now;
  const filtered = filterCandidates(candidates, settings);
  const selected = diversifyByFamily(filtered, settings.articleCount).map((article) => briefArticle(article, now));
  const groups = groupByFamily(selected);
  const brief = {
    id: key.replace("brief:", ""),
    pluginId: PLUGIN_ID,
    generatedAt: now,
    windowStartAt,
    windowEndAt,
    timezone: settings.timezone,
    articleCount: selected.length,
    receivedArticleCount: await countDiscoveredArticles(ctx, windowStartAt, windowEndAt),
    topicCount: groups.length,
    emptyReason: selected.length === 0 ? "no_articles_for_settings" : null,
    groups
  };

  await ctx.storage.set(key, brief);
  await pruneBriefs(ctx);
  return brief;
}

async function readTargets(ctx) {
  return typeof ctx.ranking.listTopicTargets === "function"
    ? await ctx.ranking.listTopicTargets()
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
    state: article.state ?? null,
    snapshotAt: now
  };
}

async function countDiscoveredArticles(ctx, startAt, endAt) {
  if (!ctx.articles || typeof ctx.articles.countDiscovered !== "function") {
    return null;
  }
  return await ctx.articles.countDiscovered({ startAt, endAt });
}

async function listBriefs(ctx, targets) {
  const resolvedTargets = targets ?? await readTargets(ctx);
  return (await ctx.storage.listByPrefix("brief:"))
    .map((item) => item.value)
    .sort((left, right) => right.generatedAt - left.generatedAt)
    .slice(0, 30)
    .map((brief) => hydrateBriefLabels(brief, resolvedTargets));
}

function latestFromBriefs(briefs) {
  return briefs[0] ?? null;
}

async function pruneBriefs(ctx) {
  const rows = (await ctx.storage.listByPrefix("brief:"))
    .sort((left, right) => right.value.generatedAt - left.value.generatedAt);
  for (const row of rows.slice(30)) {
    await ctx.storage.delete(row.key);
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

function hydrateBriefLabels(brief, targets) {
  if (!brief || typeof brief !== "object") {
    return brief;
  }
  const familyLabels = new Map((targets?.families || []).map((family) => [family.id, family.label]));
  const clusterLabels = new Map((targets?.clusters || []).map((cluster) => [cluster.id, cluster.label]));
  const articles = (brief.groups || []).flatMap((group) =>
    (group.articles || []).map((article) => hydrateBriefArticleLabels(article, familyLabels, clusterLabels))
  );
  const groups = articles.length > 0 ? groupByFamily(articles) : null;
  return {
    ...brief,
    topicCount: groups ? groups.length : brief.topicCount,
    groups: groups ?? (brief.groups || []).map((group) => hydrateBriefGroupLabels(group, familyLabels, clusterLabels))
  };
}

function hydrateBriefGroupLabels(group, familyLabels, clusterLabels) {
  const articles = (group.articles || []).map((article) => hydrateBriefArticleLabels(article, familyLabels, clusterLabels));
  return {
    ...group,
    label: familyLabels.get(group.id) || clusterLabels.get(group.id) || group.label,
    articles
  };
}

function hydrateBriefArticleLabels(article, familyLabels, clusterLabels) {
  return {
    ...article,
    familyLabel: familyLabels.get(article.familyId) || article.familyLabel,
    clusterLabel: clusterLabels.get(article.clusterId) || article.clusterLabel
  };
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
