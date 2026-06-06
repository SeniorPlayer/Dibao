import { randomUUID } from "node:crypto";

const PLUGIN_ID = "app.dibao.webhook";
const RULES_KEY = "rules";
const EVENTS = [
  "article.created",
  "article.updated",
  "article.actionRecorded",
  "feed.refreshCompleted",
  "ranking.afterRanked",
  "settings.afterUpdated",
  "plugin.taskSucceeded",
  "plugin.taskFailed",
  "dailyBrief.generated"
];
const ARTICLE_ACTIONS = [
  "impression",
  "open",
  "mark_read",
  "mark_unread",
  "favorite",
  "unfavorite",
  "like",
  "unlike",
  "read_later",
  "remove_read_later",
  "hide",
  "not_interested",
  "read_progress"
];
const OPERATORS = new Set(["equals", "contains", "exists"]);
const METHODS = new Set(["GET", "POST"]);
const EVENT_CATALOG = buildEventCatalog();

export default {
  activate(ctx) {
    for (const eventName of EVENTS) {
      ctx.hooks.on(eventName, async (event) => {
        await handleEvent(ctx, eventName, event);
      });
    }

    ctx.api.get("/state", () => state(ctx));

    ctx.api.post("/rules", ({ body }) => {
      const current = readRules(ctx);
      const rule = normalizeRule(body, { replaceDraftId: true });
      writeRules(ctx, [rule, ...current]);
      return state(ctx);
    });

    ctx.api.post("/rules/:id", ({ params, body }) => {
      const current = readRules(ctx);
      const existing = current.find((rule) => rule.id === params.id);
      if (!existing) {
        throw httpError(404, "Webhook rule not found");
      }
      const next = normalizeRule({ ...existing, ...objectValue(body), id: existing.id });
      writeRules(ctx, current.map((rule) => rule.id === existing.id ? next : rule));
      return state(ctx);
    });

    ctx.api.post("/rules/:id/test", async ({ params, body }) => {
      const rule = readRules(ctx).find((candidate) => candidate.id === params.id);
      if (!rule) {
        throw httpError(404, "Webhook rule not found");
      }
      const input = objectValue(body);
      const eventName = stringValue(input.eventName) || rule.eventName;
      const event = objectValue(input.event);
      const delivery = await dispatchRule(ctx, rule, eventName, {
        ...sampleEvent(eventName),
        ...event,
        test: true
      }, { force: true, test: true });
      const completedDelivery = delivery ? await ctx.deliveries.flush(delivery.id) : delivery;
      return { delivery: completedDelivery, state: state(ctx) };
    });

    ctx.api.post("/rules/:id/delete", ({ params }) => {
      writeRules(ctx, readRules(ctx).filter((rule) => rule.id !== params.id));
      return state(ctx);
    });

    ctx.api.post("/secrets/:key", ({ params, body }) => {
      const input = objectValue(body);
      const value = typeof input.value === "string" ? input.value : "";
      if (!value) {
        throw httpError(400, "Secret value is required");
      }
      return {
        secret: ctx.secrets.set(params.key, value, nullableString(input.hint)),
        state: state(ctx)
      };
    });

    ctx.api.post("/secrets/:key/delete", ({ params }) => {
      ctx.secrets.delete(params.key);
      return state(ctx);
    });
  }
};

async function handleEvent(ctx, eventName, event) {
  for (const rule of readRules(ctx)) {
    if (!rule.enabled || rule.eventName !== eventName) {
      continue;
    }
    const context = buildContext(ctx, rule, eventName, event);
    if (matchesConditions(rule.conditions, context)) {
      await dispatchRuleWithContext(ctx, rule, context, {});
    }
  }
}

async function dispatchRule(ctx, rule, eventName, event, options = {}) {
  const context = buildContext(ctx, rule, eventName, event, options);
  if (!options.force && !matchesConditions(rule.conditions, context)) {
    return null;
  }
  return await dispatchRuleWithContext(ctx, rule, context, options);
}

async function dispatchRuleWithContext(ctx, rule, context, options = {}) {
  const renderedUrl = renderString(rule.urlTemplate, context);
  if (!renderedUrl) {
    throw httpError(400, "Webhook URL is required");
  }
  const generatedAt = context.generatedAt;
  const basePayload = {
    eventName: context.eventName,
    event: context.event,
    article: context.article,
    generatedAt,
    ruleId: rule.id
  };
  const headers = renderHeaders(rule.headers, context);
  const secretHeaders = normalizeSecretHeaders(rule.secretHeaders);
  const request = {
    method: rule.method,
    url: rule.method === "GET"
      ? mergeQuery(renderedUrl, renderTemplate(rule.queryTemplate, context, { fallback: {} }))
      : renderedUrl,
    headers,
    secretHeaders,
    body: rule.method === "POST"
      ? renderTemplate(rule.bodyTemplate, context, { fallback: basePayload })
      : null,
    maxAttempts: options.test ? 1 : 5
  };
  const idempotencyKey = deliveryIdempotencyKey(rule, context, options);
  if (idempotencyKey) {
    request.idempotencyKey = idempotencyKey;
  }
  return ctx.deliveries.enqueue(request);
}

function buildContext(ctx, rule, eventName, event, options = {}) {
  const eventObject = objectValue(event);
  const articleId = stringValue(eventObject.articleId);
  const includeContent = rule.includeContent === true;
  const article = articleId
    ? ctx.articles.snapshot(articleId, { includeContent })
    : null;
  return {
    pluginId: PLUGIN_ID,
    ruleId: rule.id,
    eventName,
    event: eventObject,
    article,
    feed: article?.feed ?? (eventObject.feedId ? { id: eventObject.feedId } : null),
    generatedAt: ctx.now(),
    test: options.test === true
  };
}

function readRules(ctx) {
  const value = ctx.storage.get(RULES_KEY);
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value.map(normalizeRule).filter((rule) => rule.urlTemplate);
  const deduped = dedupeRules(normalized);
  let repairedDraftId = false;
  const repaired = deduped.map((rule) => {
    if (!rule.id.startsWith("draft_")) {
      return rule;
    }
    repairedDraftId = true;
    return { ...rule, id: `rule_${randomUUID()}` };
  });
  if (repairedDraftId || deduped.length !== normalized.length) {
    ctx.storage.set(RULES_KEY, repaired.map(normalizeRule));
  }
  return repaired;
}

function writeRules(ctx, rules) {
  ctx.storage.set(RULES_KEY, dedupeRules(rules.map(normalizeRule)));
}

function state(ctx) {
  const available = typeof ctx.events.catalog === "function" ? ctx.events.catalog() : EVENTS;
  return {
    pluginId: PLUGIN_ID,
    rules: readRules(ctx),
    secrets: ctx.secrets.list(),
    deliveries: ctx.deliveries.list({ limit: 50 }),
    events: EVENTS
      .filter((eventName) => available.includes(eventName))
      .map((eventName) => EVENT_CATALOG[eventName] ?? eventMetadata(eventName, eventName, "稳定插件事件。", [], [])),
    generatedAt: ctx.now()
  };
}

function normalizeRule(input, options = {}) {
  const record = objectValue(input);
  const method = stringValue(record.method).toUpperCase();
  const eventName = stringValue(record.eventName);
  const inputId = stringValue(record.id);
  const id = !inputId || (options.replaceDraftId && inputId.startsWith("draft_")) ? `rule_${randomUUID()}` : inputId;
  return {
    id,
    name: stringValue(record.name) || "Untitled rule",
    enabled: record.enabled !== false,
    eventName: EVENTS.includes(eventName) ? eventName : EVENTS[0],
    conditions: normalizeConditions(record.conditions),
    method: METHODS.has(method) ? method : "POST",
    urlTemplate: stringValue(record.urlTemplate),
    queryTemplate: plainObject(record.queryTemplate),
    bodyTemplate: plainObject(record.bodyTemplate),
    headers: stringRecord(record.headers),
    secretHeaders: normalizeSecretHeaders(record.secretHeaders),
    includeContent: record.includeContent === true,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now()
  };
}

function dedupeRules(rules) {
  const seen = new Set();
  return rules.filter((rule) => {
    if (!rule?.id || seen.has(rule.id)) {
      return false;
    }
    seen.add(rule.id);
    return true;
  });
}

function normalizeConditions(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((condition) => {
      const record = objectValue(condition);
      const path = stringValue(record.path);
      const operator = stringValue(record.operator);
      if (!path || !OPERATORS.has(operator)) {
        return null;
      }
      return {
        path,
        operator,
        value: record.value ?? ""
      };
    })
    .filter(Boolean);
}

function matchesConditions(conditions, context) {
  for (const condition of conditions) {
    const value = getPath(context, condition.path);
    if (condition.operator === "exists") {
      if (value === null || value === undefined || value === "") {
        return false;
      }
      continue;
    }
    if (condition.operator === "equals") {
      if (String(value ?? "") !== String(condition.value ?? "")) {
        return false;
      }
      continue;
    }
    if (condition.operator === "contains") {
      if (Array.isArray(value)) {
        if (!value.map((item) => String(item)).includes(String(condition.value ?? ""))) {
          return false;
        }
      } else if (!String(value ?? "").includes(String(condition.value ?? ""))) {
        return false;
      }
    }
  }
  return true;
}

function renderTemplate(template, context, options = {}) {
  const hasTemplate = template && typeof template === "object" && !Array.isArray(template) && Object.keys(template).length > 0;
  if (!hasTemplate) {
    return options.fallback ?? {};
  }
  return renderValue(template, context);
}

function renderValue(value, context) {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/u);
    if (exact) {
      return getPath(context, exact[1]) ?? "";
    }
    return renderString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderValue(item, context)])
    );
  }
  return value;
}

function renderString(value, context) {
  return String(value ?? "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/gu, (_match, path) => {
    const resolved = getPath(context, path);
    if (resolved === null || resolved === undefined) {
      return "";
    }
    if (typeof resolved === "object") {
      return JSON.stringify(resolved);
    }
    return String(resolved);
  });
}

function renderHeaders(headers, context) {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key, renderString(value, context)])
      .filter(([key]) => key)
  );
}

function mergeQuery(urlText, query) {
  const url = new URL(urlText);
  for (const [key, value] of Object.entries(plainObject(query))) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function getPath(input, path) {
  let value = input;
  for (const part of String(path).split(".")) {
    if (!part) {
      return undefined;
    }
    if (value && typeof value === "object" && Object.hasOwn(value, part)) {
      value = value[part];
    } else {
      return undefined;
    }
  }
  return value;
}

function deliveryIdempotencyKey(rule, context, options) {
  if (options.test) {
    return null;
  }
  const event = context.event;
  const stableId = stringValue(event.id) || stringValue(event.eventId) || stringValue(event.jobId) || stringValue(event.articleId);
  if (!stableId) {
    return null;
  }
  return `${rule.id}:${context.eventName}:${stableId}:${stringValue(event.action)}`;
}

function sampleEvent(eventName) {
  const now = Date.now();
  if (eventName === "article.actionRecorded") {
    return { articleId: "article_recent", feedId: "feed_design", action: "favorite", emittedAt: now };
  }
  if (eventName === "article.created") {
    return { articleId: "article_recent", feedId: "feed_design", createdAt: now };
  }
  if (eventName === "article.updated") {
    return { articleId: "article_recent", feedId: "feed_design", updatedAt: now };
  }
  if (eventName.startsWith("article.")) {
    return { articleId: "article_recommended", feedId: "feed_design", emittedAt: now };
  }
  if (eventName === "feed.refreshCompleted") {
    return { feedId: "feed_design", articleIds: ["article_recent"], articlesSeen: 12, refreshedAt: now };
  }
  if (eventName === "ranking.afterRanked") {
    return { articleIds: ["article_recent"], candidateCount: 120, rankedCount: 30, finishedAt: now };
  }
  if (eventName === "settings.afterUpdated") {
    return { scope: "reader", keys: ["density"], updatedAt: now };
  }
  if (eventName === "plugin.taskSucceeded") {
    return { pluginId: "app.dibao.example", taskId: "task.example", finishedAt: now };
  }
  if (eventName === "plugin.taskFailed") {
    return { pluginId: "app.dibao.example", taskId: "task.example", error: "timeout", finishedAt: now };
  }
  if (eventName === "dailyBrief.generated") {
    return { briefId: "brief_today", articleIds: ["article_recent"], generatedAt: now };
  }
  return { emittedAt: now };
}

function buildEventCatalog() {
  const articleFields = [
    field("event.articleId", "文章 ID", "article_recent"),
    field("event.feedId", "订阅源 ID", "feed_design"),
    field("article.title", "文章标题", "Dense reader interfaces"),
    field("article.url", "文章原文链接", "https://example.com/article"),
    field("article.feed.title", "订阅源标题", "Design Systems Weekly"),
    field("article.summary", "文章摘要", "Reader density without visual clutter.")
  ];
  const articleVariables = [
    variable("event.articleId", "触发事件里的文章 ID", "article_recent"),
    variable("event.feedId", "触发事件里的订阅源 ID", "feed_design"),
    variable("article.title", "文章标题", "Dense reader interfaces"),
    variable("article.url", "文章原文链接", "https://example.com/article"),
    variable("article.feed.title", "订阅源标题", "Design Systems Weekly"),
    variable("article.summary", "文章摘要", "Reader density without visual clutter."),
    variable("article.contentText", "文章正文纯文本。需要勾选发送全文。", "Reader density without visual clutter."),
    variable("article.contentHtml", "文章 HTML 正文。需要勾选发送全文。", "<p>Reader density...</p>")
  ];
  return Object.fromEntries([
    eventMetadata(
      "article.created",
      "文章创建",
      "有新文章进入邸报时触发，适合把新内容同步到外部系统。",
      [...articleFields, field("event.createdAt", "创建时间戳", "1717000000000")],
      [...articleVariables, variable("event.createdAt", "文章创建时间戳", "1717000000000")]
    ),
    eventMetadata(
      "article.updated",
      "文章更新",
      "文章元数据或正文更新时触发。",
      [...articleFields, field("event.updatedAt", "更新时间戳", "1717000000000")],
      [...articleVariables, variable("event.updatedAt", "文章更新时间戳", "1717000000000")]
    ),
    eventMetadata(
      "article.actionRecorded",
      "文章行为",
      "用户对文章产生阅读、收藏、点赞、隐藏等行为时触发。",
      [
        ...articleFields,
        field("event.action", "行为类型", "favorite", ARTICLE_ACTIONS),
        field("event.progress", "阅读进度，部分行为才有", "0.6")
      ],
      [
        ...articleVariables,
        variable("event.action", "行为类型，例如 favorite、open、hide。", "favorite", ARTICLE_ACTIONS),
        variable("event.progress", "阅读进度，read_progress 行为可能提供。", "0.6")
      ]
    ),
    eventMetadata(
      "feed.refreshCompleted",
      "订阅源刷新完成",
      "一个订阅源刷新完成后触发，可用于通知外部系统本次刷新结果。",
      [
        field("event.feedId", "订阅源 ID", "feed_design"),
        field("event.articlesSeen", "本次看到的文章数", "12"),
        field("event.articleIds", "本次刷新涉及的文章 ID 列表", "article_recent"),
        field("event.refreshedAt", "刷新完成时间戳", "1717000000000")
      ],
      [
        variable("event.feedId", "订阅源 ID", "feed_design"),
        variable("feed.id", "订阅源 ID。如果事件绑定文章，也可能来自文章快照。", "feed_design"),
        variable("event.articlesSeen", "本次看到的文章数", "12"),
        variable("event.articleIds", "本次刷新涉及的文章 ID 列表", "[\"article_recent\"]"),
        variable("event.refreshedAt", "刷新完成时间戳", "1717000000000")
      ]
    ),
    eventMetadata(
      "ranking.afterRanked",
      "推荐排序完成",
      "推荐排序完成后触发，适合把排序运行状态发送给外部自动化。",
      [
        field("event.candidateCount", "候选文章数", "120"),
        field("event.rankedCount", "排序后文章数", "30"),
        field("event.articleIds", "排序文章 ID 列表", "article_recent")
      ],
      [
        variable("event.candidateCount", "候选文章数", "120"),
        variable("event.rankedCount", "排序后文章数", "30"),
        variable("event.articleIds", "排序文章 ID 列表", "[\"article_recent\"]"),
        variable("event.finishedAt", "排序完成时间戳", "1717000000000")
      ]
    ),
    eventMetadata(
      "settings.afterUpdated",
      "设置更新",
      "核心设置被更新后触发。",
      [
        field("event.scope", "设置范围", "reader"),
        field("event.keys", "更新的设置键", "density"),
        field("event.updatedAt", "更新时间戳", "1717000000000")
      ],
      [
        variable("event.scope", "设置范围", "reader"),
        variable("event.keys", "更新的设置键列表", "[\"density\"]"),
        variable("event.updatedAt", "更新时间戳", "1717000000000")
      ]
    ),
    eventMetadata(
      "plugin.taskSucceeded",
      "插件任务成功",
      "插件后台任务成功结束时触发。",
      [
        field("event.pluginId", "插件 ID", "app.dibao.example"),
        field("event.taskId", "任务 ID", "task.example"),
        field("event.finishedAt", "完成时间戳", "1717000000000")
      ],
      [
        variable("event.pluginId", "插件 ID", "app.dibao.example"),
        variable("event.taskId", "任务 ID", "task.example"),
        variable("event.finishedAt", "完成时间戳", "1717000000000")
      ]
    ),
    eventMetadata(
      "plugin.taskFailed",
      "插件任务失败",
      "插件后台任务失败时触发。",
      [
        field("event.pluginId", "插件 ID", "app.dibao.example"),
        field("event.taskId", "任务 ID", "task.example"),
        field("event.error", "错误摘要", "timeout")
      ],
      [
        variable("event.pluginId", "插件 ID", "app.dibao.example"),
        variable("event.taskId", "任务 ID", "task.example"),
        variable("event.error", "错误摘要", "timeout"),
        variable("event.finishedAt", "完成时间戳", "1717000000000")
      ]
    ),
    eventMetadata(
      "dailyBrief.generated",
      "每日简报生成",
      "每日简报生成完成后触发。",
      [
        field("event.briefId", "简报 ID", "brief_today"),
        field("event.articleIds", "简报文章 ID 列表", "article_recent"),
        field("event.generatedAt", "生成时间戳", "1717000000000")
      ],
      [
        variable("event.briefId", "简报 ID", "brief_today"),
        variable("event.articleIds", "简报文章 ID 列表", "[\"article_recent\"]"),
        variable("event.generatedAt", "生成时间戳", "1717000000000")
      ]
    )
  ].map((metadata) => [metadata.name, metadata]));
}

function eventMetadata(name, title, description, fields, variables) {
  const sample = sampleEvent(name);
  const commonVariables = [
    variable("eventName", "事件名称", name),
    variable("generatedAt", "Webhook 规则处理时间", "2026-06-06T08:00:00.000Z"),
    variable("ruleId", "当前规则 ID", "rule_..."),
    variable("event", "完整事件对象快照", JSON.stringify(sample)),
    variable("test", "是否为测试发送", "false")
  ];
  return {
    name,
    title,
    description,
    fields,
    variables: [...commonVariables, ...variables],
    sample
  };
}

function field(path, description, example, options = undefined) {
  return compactObject({ path, description, example, options });
}

function variable(path, description, example, options = undefined) {
  return compactObject({ path, description, example, options });
}

function compactObject(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function normalizeSecretHeaders(value) {
  const output = {};
  for (const [header, input] of Object.entries(plainObject(value))) {
    const record = objectValue(input);
    const key = stringValue(record.key);
    if (!header || !key) {
      continue;
    }
    output[header] = {
      key,
      prefix: typeof record.prefix === "string" ? record.prefix : ""
    };
  }
  return output;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function objectValue(value) {
  return plainObject(value);
}

function stringRecord(value) {
  return Object.fromEntries(
    Object.entries(plainObject(value))
      .map(([key, item]) => [stringValue(key), stringValue(item)])
      .filter(([key]) => key)
  );
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value) {
  const next = stringValue(value);
  return next || null;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = statusCode === 404 ? "NOT_FOUND" : "VALIDATION_ERROR";
  return error;
}
