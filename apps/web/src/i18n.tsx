import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const defaultLocale = "zh-CN";
export const supportedLocales = ["zh-CN", "en-US"] as const;

export type Locale = (typeof supportedLocales)[number];

export const zhCN = {
  common: {
    brandMark: "邸",
    brandName: "邸报",
    brandSubtitle: "Dibao",
    version: (version: string) => `v${version}`
  },
  navigation: {
    ariaLabel: "主导航",
    items: {
      latest: "最新",
      recommended: "推荐",
      saved: "收藏",
      readLater: "稍后读",
      search: "搜索",
      feeds: "订阅源",
      settings: "设置"
    }
  },
  shell: {
    kicker: "RSS Ingestion",
    pageTitle: "最新文章",
    pageTitles: {
      latest: "最新文章",
      recommended: "推荐文章"
    },
    loadingArticles: "正在加载文章",
    latestView: "最新视图",
    viewStatus: {
      latest: "最新视图",
      recommended: "推荐视图"
    }
  },
  auth: {
    loading: "正在检查登录状态",
    setupTitle: "设置访问密码",
    setupBody: "这是单用户自托管实例。设置一个访问密码后即可进入阅读器。",
    loginTitle: "登录邸报",
    loginBody: "输入访问密码继续。",
    passwordLabel: "访问密码",
    passwordPlaceholder: "至少 8 个字符",
    setupSubmit: "完成设置",
    loginSubmit: "登录",
    submitting: "处理中",
    logout: "退出",
    logoutTitle: "退出登录",
    passwordRequired: "请输入访问密码。",
    errors: {
      session: "无法读取登录状态。",
      logout: "退出登录失败。"
    }
  },
  setup: {
    kicker: "首次设置",
    welcome: {
      title: "欢迎使用邸报",
      body: "一个自托管的个人 RSS 推荐阅读器。先完成几个必要步骤，再进入阅读界面。",
      start: "开始设置"
    },
    sources: {
      title: "添加订阅源",
      body: "导入 OPML 文件，或手动添加一个 RSS / Atom 源。至少需要一个订阅源才能继续。",
      importOpml: "导入 OPML 文件",
      addFeed: "添加订阅源",
      noFeedsAfterImport: "导入完成，但没有创建新的订阅源。请检查 OPML 文件或手动添加 RSS / Atom 地址。",
      noFeedsAfterAdd: "订阅源尚未创建成功，请重试。"
    },
    provider: {
      title: "推荐能力",
      body: "当前先使用基础排序。Embedding provider 会在后续设置中配置，本轮不会发送正文到外部服务。",
      currentTitle: "当前使用基础排序",
      currentBody: "你仍然可以阅读、收藏、稍后读，并让基础排序使用这些行为信号。",
      continue: "暂不配置，继续"
    }
  },
  feeds: {
    kicker: "订阅源",
    title: "Feeds",
    inputLabel: "RSS / Atom URL",
    inputPlaceholder: "https://example.com/feed.xml",
    add: "添加",
    adding: "添加中",
    allFeeds: "全部订阅源",
    sourceCount: (count: number) => `${count} 个来源`,
    feedUrlRequired: "请输入 RSS / Atom 地址。",
    successAt: (date: string) => `成功：${date}`,
    refresh: "刷新",
    refreshing: "…",
    refreshAll: "刷新全部",
    refreshingAll: "加入队列中",
    refreshTitle: (feedTitle: string) => `刷新 ${feedTitle}`
  },
  folders: {
    title: "分组",
    feedCount: (count: number) => `${count} 个订阅源`
  },
  feedManagement: {
    pageTitle: "订阅源管理",
    loading: "正在加载订阅源",
    status: (feedCount: number, folderCount: number) =>
      `${feedCount} 个订阅源 · ${folderCount} 个分组`,
    na: "暂无",
    folders: {
      kicker: "Folders",
      title: "分组",
      newLabel: "新建分组",
      newPlaceholder: "例如：科技",
      create: "创建",
      emptyTitle: "还没有分组",
      emptyBody: "创建分组后，可以把订阅源整理到一起。",
      renameLabel: (title: string) => `重命名 ${title}`,
      confirmDelete: "确认删除",
      deleteHint: "删除分组不会删除订阅源，订阅源会移动到未分组。"
    },
    feeds: {
      kicker: "Feeds",
      title: "订阅源",
      emptyTitle: "还没有订阅源",
      emptyBody: "可以在阅读器侧栏添加 RSS / Atom 源，或导入 OPML。",
      ungrouped: "未分组",
      enabled: "已启用",
      disabled: "已禁用",
      weight: (value: number) => `权重 ${value}`,
      lastSuccess: (value: string) => `最近成功：${value}`,
      confirmDelete: "确认删除",
      deleteHint: "删除订阅源不会物理删除历史文章，但它们不会继续出现在文章列表中。"
    },
    editor: {
      kicker: "Edit feed",
      titleLabel: "标题",
      feedUrlLabel: "Feed URL",
      folderLabel: "分组",
      enabledLabel: "启用订阅源",
      sourceWeightLabel: "来源权重",
      lastFetchedAt: "最近抓取",
      lastSuccessAt: "最近成功",
      lastError: "最近错误",
      emptyTitle: "选择一个订阅源",
      emptyBody: "选择后可以编辑标题、分组、启用状态和来源权重。"
    },
    actions: {
      save: "保存",
      saving: "保存中",
      cancel: "取消",
      rename: "重命名",
      delete: "删除"
    },
    errors: {
      folderTitleRequired: "请输入分组名称。",
      feedTitleRequired: "请输入订阅源标题。",
      sourceWeight: "来源权重必须是 -1 到 1 之间的数字。"
    }
  },
  settings: {
    pageTitle: "设置",
    loading: "正在加载设置",
    status: "设置已就绪",
    sections: {
      language: {
        title: "语言",
        body: "选择界面语言。设置保存后刷新页面仍会生效。",
        localeLabel: "界面语言",
        zhCN: "简体中文",
        enUS: "English"
      },
      reader: {
        title: "阅读",
        body: "调整文章详情的阅读密度。修改会立即应用到当前阅读区域。",
        fontSize: "字号",
        lineHeight: "行高",
        paragraphGap: "段距",
        readerWidth: "阅读宽度"
      },
      retention: {
        title: "文章保留",
        body: "超过保留天数的普通文章会由后台清理。收藏和稍后读保留策略本轮固定开启。",
        retentionDays: "保留天数",
        keepFavorites: "保留收藏文章",
        keepReadLater: "保留稍后读文章",
        enabled: "已开启",
        disabled: "已关闭",
        mappingHint: "API 字段 retention.retentionDays 会保存到 storage key retention.articleDays。"
      },
      provider: {
        title: "智能能力",
        body: "配置 OpenAI-compatible embedding endpoint。未配置或停用时，系统继续使用基础排序。",
        loading: "正在加载智能能力设置",
        providerLabel: "Provider",
        newProvider: "新建 OpenAI-compatible provider",
        typeLabel: "类型",
        openaiCompatible: "OpenAI-compatible",
        nameLabel: "名称",
        baseUrlLabel: "Base URL",
        baseUrlPlaceholder: "https://api.example.com/v1",
        modelLabel: "模型",
        modelPlaceholder: "text-embedding-3-small",
        dimensionLabel: "维度",
        apiKeyLabel: "API Key",
        apiKeyPlaceholder: "可选，按 endpoint 要求填写",
        apiKeyRetainPlaceholder: "留空则保留已保存密钥",
        qualityTierLabel: "质量档位",
        quality: {
          basic: "基础",
          recommended: "推荐",
          bestQuality: "高质量"
        },
        enabledLabel: "启用 provider",
        enabledStatus: "已启用",
        disabledStatus: "已停用",
        disabled: "暂未配置",
        lastTestSuccess: (value: string) => `连接测试成功：${value}`,
        lastTestFailed: (value: string) => `连接测试失败：${value}`,
        lastTestUnknown: "尚未测试连接。",
        save: "保存 provider",
        saving: "保存中",
        test: "测试连接",
        testing: "测试中",
        delete: "删除",
        deleting: "删除中",
        deleteHint: "已有 embedding index 的 provider 不能删除；需要停用时请关闭启用状态。",
        indexesTitle: "Embedding indexes",
        indexesBody: "当前 index 只记录状态和队列计数；具体错误会记录在后台 jobs 或 provider 最近测试错误中。",
        noIndexes: "保存并启用 provider 后会创建 active index。",
        indexStatus: (model: string, status: string, count: number) =>
          `${model} · ${status} · ${count} 条 embedding`,
        rebuild: "重建",
        rebuilding: "已加入",
        notices: {
          saved: "Embedding provider 已保存。",
          tested: "连接测试成功。",
          deleted: "Embedding provider 已删除。",
          rebuildQueued: "Embedding index 重建已加入队列。"
        },
        errors: {
          nameRequired: "请输入 provider 名称。",
          baseUrlRequired: "请输入 Base URL。",
          modelRequired: "请输入模型名称。",
          dimension: "维度必须是 1 到 20000 的整数。"
        }
      }
    },
    actions: {
      save: "保存设置",
      saving: "保存中"
    },
    notices: {
      saved: "设置已保存。"
    },
    errors: {
      invalidNumber: "请输入有效数字。",
      fontSize: "字号必须是 16 到 24。",
      lineHeight: "行高必须是 1.45 到 2.1。",
      paragraphGap: "段距必须是 0.6 到 1.6。",
      readerWidth: "阅读宽度必须是 560 到 860。",
      retentionDays: "保留天数必须是 1 到 3650 的整数。"
    },
    units: {
      px: "px",
      days: "天"
    }
  },
  opml: {
    import: "导入 OPML",
    importing: "导入中",
    export: "导出 OPML",
    exporting: "导出中",
    importSummary: (feedsCreated: number, feedsSkipped: number, foldersCreated: number) =>
      `已导入 ${feedsCreated} 个订阅源，跳过 ${feedsSkipped} 个，新增 ${foldersCreated} 个分组。`,
    importErrors: (count: number) => `${count} 条导入项未完成。`
  },
  articles: {
    allSources: "全部来源",
    title: "Latest",
    views: {
      latest: "最新",
      recommended: "推荐"
    },
    loadMore: "加载更多",
    loadingMore: "加载中",
    emptyNoFeedsTitle: "还没有订阅源",
    emptyNoFeedsBody: "添加一个 RSS / Atom 源后，文章会出现在这里。",
    emptyNoArticlesTitle: "暂时没有文章",
    emptyNoArticlesBody: "可以刷新订阅源，或切换到全部来源查看。",
    itemMeta: (date: string, feedTitle: string) => `${date} · ${feedTitle}`,
    state: {
      read: "已读",
      unread: "未读",
      favorited: "已收藏",
      readLater: "稍后读"
    }
  },
  reader: {
    originalLink: "原文",
    selectArticleTitle: "选择一篇文章",
    selectArticleBody: "文章详情会在这里打开。",
    feedOnlyNotice: "当前仅有订阅源摘要。",
    noContent: "这篇文章暂无正文内容。",
    meta: (feedTitle: string, date?: string, author?: string | null) =>
      [feedTitle, date, author].filter(Boolean).join(" · ")
  },
  explanation: {
    title: "为什么推荐",
    loading: "正在生成推荐解释",
    empty: "当前没有明确的推荐信号。",
    generatedAt: (date: string) => `生成于 ${date}`,
    types: {
      interest: "兴趣匹配",
      source: "来源",
      freshness: "新鲜度",
      state: "状态",
      fallback: "基础排序",
      negative: "负向",
      penalty: "过滤"
    },
    reasons: {
      interest: "与你近期的正向兴趣相似，因此排序更靠前。",
      sourcePositive: (label: string) => `来源 ${label} 对排序有正向影响。`,
      sourceNegative: (label: string) => `来源 ${label} 当前权重偏低。`,
      freshness: "文章较新，获得新鲜度加分。",
      statePositive: "收藏、稍后读或阅读进度提高了排序。",
      stateNegative: "已读等状态降低了排序优先级。",
      fallback: "当前使用基础排序，暂时没有更强的推荐信号。",
      negative: "近期负向行为降低了排序。",
      penalty: "隐藏或不感兴趣会显著降低排序。"
    }
  },
  actions: {
    favorite: "收藏",
    unfavorite: "取消收藏",
    readLater: "稍后读",
    removeReadLater: "移出稍后读",
    markRead: "标记已读",
    markUnread: "标记未读",
    notInterested: "不感兴趣",
    notInterestedActive: "已不感兴趣",
    saving: "处理中",
    aria: {
      favorite: "收藏这篇文章",
      unfavorite: "取消收藏这篇文章",
      readLater: "稍后读这篇文章",
      removeReadLater: "移出稍后读",
      markRead: "标记这篇文章为已读",
      markUnread: "标记这篇文章为未读",
      notInterested: "不再推荐类似文章",
      notInterestedActive: "已标记不感兴趣"
    },
    errors: {
      favorite: "收藏失败。",
      readLater: "稍后读更新失败。",
      readStatus: "已读状态更新失败。",
      notInterested: "不感兴趣操作失败。",
      open: "记录打开行为失败。",
      generic: "操作失败，请重试。"
    }
  },
  notices: {
    feedAddedAndRefreshed: (feedTitle: string) => `已添加并刷新：${feedTitle}`,
    feedRefreshed: (feedTitle: string) => `已刷新：${feedTitle}`,
    allFeedsRefreshQueued: (count: number) =>
      count > 0 ? `已加入刷新队列：${count} 个订阅源。` : "没有启用的订阅源需要刷新。",
    opmlImported: (feedsCreated: number, feedsSkipped: number, foldersCreated: number) =>
      `OPML 导入完成：新增 ${feedsCreated} 个订阅源，跳过 ${feedsSkipped} 个，新增 ${foldersCreated} 个分组。`,
    opmlExported: "OPML 已导出。"
  },
  errors: {
    api: {
      requestFailed: "请求失败，请稍后重试。",
      httpError: (status: number) => `请求失败（HTTP ${status}）。`
    }
  }
} as const;

type WidenDictionary<T> = T extends (...args: infer Args) => infer Return
  ? (...args: Args) => Return
  : T extends string
    ? string
    : T extends object
      ? { readonly [Key in keyof T]: WidenDictionary<T[Key]> }
      : T;

export type Dictionary = WidenDictionary<typeof zhCN>;
export type NavigationItemKey = keyof Dictionary["navigation"]["items"];

export const enUS = {
  common: {
    brandMark: "D",
    brandName: "Dibao",
    brandSubtitle: "Reader",
    version: (version: string) => `v${version}`
  },
  navigation: {
    ariaLabel: "Primary navigation",
    items: {
      latest: "Latest",
      recommended: "Recommended",
      saved: "Saved",
      readLater: "Read Later",
      search: "Search",
      feeds: "Feeds",
      settings: "Settings"
    }
  },
  shell: {
    kicker: "RSS Ingestion",
    pageTitle: "Latest Articles",
    pageTitles: {
      latest: "Latest Articles",
      recommended: "Recommended Articles"
    },
    loadingArticles: "Loading articles",
    latestView: "Latest view",
    viewStatus: {
      latest: "Latest view",
      recommended: "Recommended view"
    }
  },
  auth: {
    loading: "Checking session",
    setupTitle: "Set access password",
    setupBody: "This is a single-user self-hosted instance. Set an access password to enter the reader.",
    loginTitle: "Log in to Dibao",
    loginBody: "Enter the access password to continue.",
    passwordLabel: "Access password",
    passwordPlaceholder: "At least 8 characters",
    setupSubmit: "Finish setup",
    loginSubmit: "Log in",
    submitting: "Working",
    logout: "Log out",
    logoutTitle: "Log out",
    passwordRequired: "Enter the access password.",
    errors: {
      session: "Unable to read session state.",
      logout: "Log out failed."
    }
  },
  setup: {
    kicker: "First-run setup",
    welcome: {
      title: "Welcome to Dibao",
      body: "A self-hosted personal RSS recommendation reader. Complete the required steps before entering the reader.",
      start: "Start setup"
    },
    sources: {
      title: "Add feeds",
      body: "Import an OPML file or manually add an RSS / Atom feed. At least one feed is required to continue.",
      importOpml: "Import OPML file",
      addFeed: "Add feed",
      noFeedsAfterImport: "Import finished, but no feeds were created. Check the OPML file or add an RSS / Atom URL manually.",
      noFeedsAfterAdd: "The feed was not created. Please try again."
    },
    provider: {
      title: "Recommendation capability",
      body: "Dibao will use baseline ranking for now. Embedding providers will be configured in later settings, and this step does not send article text to external services.",
      currentTitle: "Baseline ranking is active",
      currentBody: "You can still read, favorite, save for later, and let baseline ranking use those behavior signals.",
      continue: "Skip for now and continue"
    }
  },
  feeds: {
    kicker: "Feeds",
    title: "Feeds",
    inputLabel: "RSS / Atom URL",
    inputPlaceholder: "https://example.com/feed.xml",
    add: "Add",
    adding: "Adding",
    allFeeds: "All feeds",
    sourceCount: (count: number) => `${count} ${count === 1 ? "source" : "sources"}`,
    feedUrlRequired: "Enter an RSS / Atom URL.",
    successAt: (date: string) => `Success: ${date}`,
    refresh: "Refresh",
    refreshing: "…",
    refreshAll: "Refresh all",
    refreshingAll: "Queueing",
    refreshTitle: (feedTitle: string) => `Refresh ${feedTitle}`
  },
  folders: {
    title: "Folders",
    feedCount: (count: number) => `${count} ${count === 1 ? "feed" : "feeds"}`
  },
  feedManagement: {
    pageTitle: "Feed Management",
    loading: "Loading feeds",
    status: (feedCount: number, folderCount: number) =>
      `${feedCount} ${feedCount === 1 ? "feed" : "feeds"} · ${folderCount} ${folderCount === 1 ? "folder" : "folders"}`,
    na: "None",
    folders: {
      kicker: "Folders",
      title: "Folders",
      newLabel: "New folder",
      newPlaceholder: "For example: Tech",
      create: "Create",
      emptyTitle: "No folders yet",
      emptyBody: "Create folders to organize feeds together.",
      renameLabel: (title: string) => `Rename ${title}`,
      confirmDelete: "Confirm delete",
      deleteHint: "Deleting a folder does not delete feeds. Its feeds move to Ungrouped."
    },
    feeds: {
      kicker: "Feeds",
      title: "Feeds",
      emptyTitle: "No feeds yet",
      emptyBody: "Add an RSS / Atom feed in the reader sidebar, or import OPML.",
      ungrouped: "Ungrouped",
      enabled: "Enabled",
      disabled: "Disabled",
      weight: (value: number) => `Weight ${value}`,
      lastSuccess: (value: string) => `Last success: ${value}`,
      confirmDelete: "Confirm delete",
      deleteHint: "Deleting a feed does not physically delete historical articles, but they stop appearing in article lists."
    },
    editor: {
      kicker: "Edit feed",
      titleLabel: "Title",
      feedUrlLabel: "Feed URL",
      folderLabel: "Folder",
      enabledLabel: "Enable feed",
      sourceWeightLabel: "Source weight",
      lastFetchedAt: "Last fetched",
      lastSuccessAt: "Last success",
      lastError: "Last error",
      emptyTitle: "Select a feed",
      emptyBody: "Select a feed to edit its title, folder, enabled state, and source weight."
    },
    actions: {
      save: "Save",
      saving: "Saving",
      cancel: "Cancel",
      rename: "Rename",
      delete: "Delete"
    },
    errors: {
      folderTitleRequired: "Enter a folder name.",
      feedTitleRequired: "Enter a feed title.",
      sourceWeight: "Source weight must be a number between -1 and 1."
    }
  },
  settings: {
    pageTitle: "Settings",
    loading: "Loading settings",
    status: "Settings ready",
    sections: {
      language: {
        title: "Language",
        body: "Choose the interface language. Saved settings remain after refresh.",
        localeLabel: "Interface language",
        zhCN: "简体中文",
        enUS: "English"
      },
      reader: {
        title: "Reading",
        body: "Adjust article detail reading density. Changes apply immediately to the reader.",
        fontSize: "Font size",
        lineHeight: "Line height",
        paragraphGap: "Paragraph gap",
        readerWidth: "Reader width"
      },
      retention: {
        title: "Article retention",
        body: "Background cleanup removes ordinary articles older than the retention window. Favorite and read-later retention stay enabled in this version.",
        retentionDays: "Retention days",
        keepFavorites: "Keep favorited articles",
        keepReadLater: "Keep read-later articles",
        enabled: "On",
        disabled: "Off",
        mappingHint: "API field retention.retentionDays is stored as storage key retention.articleDays."
      },
      provider: {
        title: "Intelligence",
        body: "Configure an OpenAI-compatible embedding endpoint. Without an enabled provider, Dibao keeps using baseline ranking.",
        loading: "Loading intelligence settings",
        providerLabel: "Provider",
        newProvider: "New OpenAI-compatible provider",
        typeLabel: "Type",
        openaiCompatible: "OpenAI-compatible",
        nameLabel: "Name",
        baseUrlLabel: "Base URL",
        baseUrlPlaceholder: "https://api.example.com/v1",
        modelLabel: "Model",
        modelPlaceholder: "text-embedding-3-small",
        dimensionLabel: "Dimension",
        apiKeyLabel: "API Key",
        apiKeyPlaceholder: "Optional, depending on the endpoint",
        apiKeyRetainPlaceholder: "Leave blank to keep the saved key",
        qualityTierLabel: "Quality tier",
        quality: {
          basic: "Basic",
          recommended: "Recommended",
          bestQuality: "Best quality"
        },
        enabledLabel: "Enable provider",
        enabledStatus: "Enabled",
        disabledStatus: "Disabled",
        disabled: "Not configured",
        lastTestSuccess: (value: string) => `Connection test succeeded: ${value}`,
        lastTestFailed: (value: string) => `Connection test failed: ${value}`,
        lastTestUnknown: "Connection has not been tested.",
        save: "Save provider",
        saving: "Saving",
        test: "Test connection",
        testing: "Testing",
        delete: "Delete",
        deleting: "Deleting",
        deleteHint: "Providers with embedding indexes cannot be deleted. Disable the provider instead.",
        indexesTitle: "Embedding indexes",
        indexesBody: "Indexes only store status and queue counts. Detailed errors live in jobs or the provider test state.",
        noIndexes: "Saving and enabling a provider creates an active index.",
        indexStatus: (model: string, status: string, count: number) =>
          `${model} · ${status} · ${count} ${count === 1 ? "embedding" : "embeddings"}`,
        rebuild: "Rebuild",
        rebuilding: "Queued",
        notices: {
          saved: "Embedding provider saved.",
          tested: "Connection test succeeded.",
          deleted: "Embedding provider deleted.",
          rebuildQueued: "Embedding index rebuild queued."
        },
        errors: {
          nameRequired: "Enter a provider name.",
          baseUrlRequired: "Enter the Base URL.",
          modelRequired: "Enter a model name.",
          dimension: "Dimension must be an integer from 1 to 20000."
        }
      }
    },
    actions: {
      save: "Save settings",
      saving: "Saving"
    },
    notices: {
      saved: "Settings saved."
    },
    errors: {
      invalidNumber: "Enter a valid number.",
      fontSize: "Font size must be between 16 and 24.",
      lineHeight: "Line height must be between 1.45 and 2.1.",
      paragraphGap: "Paragraph gap must be between 0.6 and 1.6.",
      readerWidth: "Reader width must be between 560 and 860.",
      retentionDays: "Retention days must be an integer between 1 and 3650."
    },
    units: {
      px: "px",
      days: "days"
    }
  },
  opml: {
    import: "Import OPML",
    importing: "Importing",
    export: "Export OPML",
    exporting: "Exporting",
    importSummary: (feedsCreated: number, feedsSkipped: number, foldersCreated: number) =>
      `Imported ${feedsCreated} ${feedsCreated === 1 ? "feed" : "feeds"}, skipped ${feedsSkipped}, added ${foldersCreated} ${foldersCreated === 1 ? "folder" : "folders"}.`,
    importErrors: (count: number) => `${count} ${count === 1 ? "item" : "items"} could not be imported.`
  },
  articles: {
    allSources: "All sources",
    title: "Latest",
    views: {
      latest: "Latest",
      recommended: "Recommended"
    },
    loadMore: "Load more",
    loadingMore: "Loading",
    emptyNoFeedsTitle: "No feeds yet",
    emptyNoFeedsBody: "Add an RSS / Atom feed and articles will appear here.",
    emptyNoArticlesTitle: "No articles yet",
    emptyNoArticlesBody: "Refresh a feed or switch back to all sources.",
    itemMeta: (date: string, feedTitle: string) => `${date} · ${feedTitle}`,
    state: {
      read: "Read",
      unread: "Unread",
      favorited: "Favorited",
      readLater: "Read later"
    }
  },
  reader: {
    originalLink: "Original",
    selectArticleTitle: "Select an article",
    selectArticleBody: "Article details will open here.",
    feedOnlyNotice: "Only the feed summary is available.",
    noContent: "This article has no body content yet.",
    meta: (feedTitle: string, date?: string, author?: string | null) =>
      [feedTitle, date, author].filter(Boolean).join(" · ")
  },
  explanation: {
    title: "Why recommended",
    loading: "Generating recommendation explanation",
    empty: "No clear recommendation signal yet.",
    generatedAt: (date: string) => `Generated ${date}`,
    types: {
      interest: "Interest",
      source: "Source",
      freshness: "Freshness",
      state: "State",
      fallback: "Baseline",
      negative: "Negative",
      penalty: "Filter"
    },
    reasons: {
      interest: "This is similar to recent positive interests, so it ranks higher.",
      sourcePositive: (label: string) => `Source ${label} is helping this rank higher.`,
      sourceNegative: (label: string) => `Source ${label} currently has a lower weight.`,
      freshness: "The article is recent and receives a freshness boost.",
      statePositive: "Favorite, read later, or reading progress raised the rank.",
      stateNegative: "Read state and similar signals lowered its priority.",
      fallback: "Baseline ranking is active and no stronger signal is available yet.",
      negative: "Recent negative behavior lowered the rank.",
      penalty: "Hidden or not interested state strongly lowers the rank."
    }
  },
  actions: {
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    readLater: "Read later",
    removeReadLater: "Remove later",
    markRead: "Mark read",
    markUnread: "Mark unread",
    notInterested: "Not interested",
    notInterestedActive: "Not interested",
    saving: "Saving",
    aria: {
      favorite: "Favorite this article",
      unfavorite: "Unfavorite this article",
      readLater: "Save this article for later",
      removeReadLater: "Remove this article from read later",
      markRead: "Mark this article as read",
      markUnread: "Mark this article as unread",
      notInterested: "Stop recommending similar articles",
      notInterestedActive: "Already marked not interested"
    },
    errors: {
      favorite: "Favorite failed.",
      readLater: "Read later update failed.",
      readStatus: "Read status update failed.",
      notInterested: "Not interested action failed.",
      open: "Failed to record article open.",
      generic: "Action failed. Please try again."
    }
  },
  notices: {
    feedAddedAndRefreshed: (feedTitle: string) => `Added and refreshed: ${feedTitle}`,
    feedRefreshed: (feedTitle: string) => `Refreshed: ${feedTitle}`,
    allFeedsRefreshQueued: (count: number) =>
      count > 0
        ? `Queued refresh for ${count} ${count === 1 ? "feed" : "feeds"}.`
        : "No enabled feeds need refresh.",
    opmlImported: (feedsCreated: number, feedsSkipped: number, foldersCreated: number) =>
      `OPML imported: added ${feedsCreated} ${feedsCreated === 1 ? "feed" : "feeds"}, skipped ${feedsSkipped}, added ${foldersCreated} ${foldersCreated === 1 ? "folder" : "folders"}.`,
    opmlExported: "OPML exported."
  },
  errors: {
    api: {
      requestFailed: "Request failed. Please try again.",
      httpError: (status: number) => `Request failed (HTTP ${status}).`
    }
  }
} as const satisfies Dictionary;

export const dictionaries = {
  "zh-CN": zhCN,
  "en-US": enUS
} as const satisfies Record<Locale, Dictionary>;

export type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
  formatDate: (value: string | Date) => string;
};

export type DibaoI18nProviderProps = {
  children: ReactNode;
  locale?: Locale;
};

const defaultI18n = createI18n(defaultLocale);
const I18nContext = createContext<I18nValue>(defaultI18n);

export function DibaoI18nProvider(props: DibaoI18nProviderProps) {
  const [locale, setLocale] = useState<Locale>(props.locale ?? defaultLocale);
  const value = useMemo(() => createI18n(locale, {}, setLocale), [locale]);

  useEffect(() => {
    if (props.locale !== undefined) {
      setLocale(props.locale);
    }
  }, [props.locale]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.lang = locale;
    document.title = dictionaries[locale].common.brandName;
  }, [locale]);

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function createI18n(
  locale: Locale = defaultLocale,
  options: { timeZone?: string } = {},
  setLocale: (locale: Locale) => void = () => undefined
): I18nValue {
  const formatter = createDateFormatter(locale, options);

  return {
    locale,
    setLocale,
    t: dictionaries[locale],
    formatDate(value) {
      return formatter.format(new Date(value));
    }
  };
}

export function createDateFormatter(
  locale: Locale = defaultLocale,
  options: { timeZone?: string } = {}
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  });
}
