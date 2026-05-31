const PLUGIN_ID = "app.dibao.daily-brief";
const TASK_ID = "dailyBrief.generate";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = {
  enabled: true,
  scheduledLocalTime: "08:00",
  timezone: "UTC",
  articleCount: 20
};

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
        briefs: listBriefs(ctx),
        latest: latestBrief(ctx)
      };
    });

    ctx.api.post("/generate", async () => {
      const settings = readSettings(ctx);
      const brief = await generateBrief(ctx, settings);
      return {
        brief,
        briefs: listBriefs(ctx)
      };
    });
  }
};

function readSettings(ctx) {
  return {
    enabled: readBoolean(ctx.settings.get("enabled"), DEFAULT_SETTINGS.enabled),
    scheduledLocalTime: readLocalTime(ctx.settings.get("scheduledLocalTime"), DEFAULT_SETTINGS.scheduledLocalTime),
    timezone: readString(ctx.settings.get("timezone"), DEFAULT_SETTINGS.timezone),
    articleCount: readInteger(ctx.settings.get("articleCount"), 5, 50, DEFAULT_SETTINGS.articleCount)
  };
}

function writeSettings(ctx, settings) {
  ctx.settings.set("enabled", settings.enabled);
  ctx.settings.set("scheduledLocalTime", settings.scheduledLocalTime);
  ctx.settings.set("timezone", settings.timezone);
  ctx.settings.set("articleCount", settings.articleCount);
}

function ensureSchedule(ctx, settings = readSettings(ctx)) {
  ctx.scheduler.configureDaily(TASK_ID, {
    enabled: settings.enabled,
    localTime: settings.scheduledLocalTime,
    timezone: settings.timezone
  });
}

async function generateBrief(ctx, settings) {
  const now = ctx.now();
  const key = briefKey(now, settings.timezone);
  const existing = ctx.storage.get(key);
  if (existing) {
    return existing;
  }

  const candidates = ctx.ranking.listRankedWinners({
    windowMs: DAY_MS,
    limit: Math.max(settings.articleCount * 5, 50)
  });
  const selected = diversifyByFamily(candidates, settings.articleCount);
  const groups = groupByFamily(selected);
  const brief = {
    id: key.replace("brief:", ""),
    pluginId: PLUGIN_ID,
    generatedAt: now,
    windowStartAt: now - DAY_MS,
    windowEndAt: now,
    timezone: settings.timezone,
    articleCount: selected.length,
    groups
  };

  ctx.storage.set(key, brief);
  pruneBriefs(ctx);
  return brief;
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
    articleCount: readInteger(object.articleCount, 5, 50, current.articleCount)
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
