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
    close: "关闭",
    version: (version: string) => `v${version}`
  },
  navigation: {
    ariaLabel: "主导航",
    items: {
      latest: "最新",
      recommended: "推荐",
      favorites: "收藏",
      read_later: "稍后读",
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
      recommended: "推荐文章",
      favorites: "收藏文章",
      read_later: "稍后读"
    },
    loadingArticles: "正在加载文章",
    latestView: "最新视图",
    viewStatus: {
      latest: "最新视图",
      recommended: "推荐视图",
      favorites: "收藏视图",
      read_later: "稍后读视图"
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
    nextRefreshAt: (date: string) => `下次抓取：${date}`,
    refresh: "刷新",
    refreshing: "…",
    refreshAll: "刷新全部",
    refreshingAll: "加入队列中",
    openSources: "来源",
    openSourcesLabel: "打开来源",
    closeSources: "关闭来源",
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
    operations: {
      kicker: "Operations",
      title: "导入、导出与刷新"
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
      nextRefresh: (value: string) => `下次抓取：${value}`,
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
      nextRefreshAt: "下次抓取",
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
        enUS: "English",
        defaultHomeViewLabel: "首页默认打开",
        defaultHomeViewRecommended: "推荐",
        defaultHomeViewLatest: "最新"
      },
      behavior: {
        title: "行为记录",
        body: "控制列表浏览和稍后读队列中的自动行为记录。",
        algorithmTransparencyLink: "查看算法透明说明",
        markScrolledArticlesIgnored: "滚过未打开文章后，将其标记为已忽略并移出未读",
        removeReadLaterOnReadComplete: "稍后读中的文章读完后，自动移出稍后读",
        cocoonLevel: "信息茧房水平",
        cocoonLevelHint: "1 表示更开放、更分散、更探索；10 表示更贴合、更稳定、更少扰动。所有级别都只在订阅源内排序，并始终尊重去重和明确负反馈。"
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
        body: "超过保留天数的文章会由后台清理；填 0 表示永久保留。收藏和稍后读可单独选择是否始终保留。",
        retentionDays: "保留天数",
        keepFavorites: "保留收藏文章",
        keepReadLater: "保留稍后读文章",
        enabled: "已开启",
        disabled: "已关闭",
        mappingHint: "API 字段 retention.retentionDays 会保存到 storage key retention.articleDays。"
      },
      provider: {
        title: "智能能力",
        body: "配置 OpenAI-compatible 或 Ollama embedding provider。未配置或停用时，系统继续使用基础排序。",
        loading: "正在加载智能能力设置",
        providerLabel: "Provider",
        newProvider: "新建 embedding provider",
        typeLabel: "类型",
        openaiCompatible: "OpenAI-compatible",
        ollama: "Ollama",
        nameLabel: "名称",
        baseUrlLabel: "Base URL",
        baseUrlPlaceholder: "https://api.example.com/v1",
        ollamaBaseUrlPlaceholder: "http://127.0.0.1:11434",
        modelLabel: "模型",
        modelPlaceholder: "text-embedding-3-small",
        ollamaModelPlaceholder: "nomic-embed-text",
        dimensionLabel: "维度",
        apiKeyLabel: "API Key",
        apiKeyPlaceholder: "可选，按 endpoint 要求填写",
        apiKeyRetainPlaceholder: "留空则保留已保存密钥",
        ollamaApiKeyHint: "Ollama 本地 API 默认不需要 API key。",
        modelHint: "可填写任意已配置的 embedding 模型；Ollama 用户请按本机模型填写模型名和维度，例如 bge-m3 / 1024。",
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
        connectionStatusTitle: "连接测试状态",
        embeddingJobStatusTitle: "Embedding job 状态",
        indexesBody: "Index 展示 coverage、队列和最近失败；连接测试与 embedding job 状态分开判断。",
        usageWindowLabel: "Embedding 用量窗口",
        usageWindows: {
          "24h": "24H",
          "7d": "7Days",
          "30d": "30Days"
        },
        usage: (requestCount: number, estimatedTokens: number) =>
          `本地估算用量：${requestCount} 次请求 · ${estimatedTokens} tokens`,
        noIndexes: "保存并启用 provider 后会创建 active index。",
        indexStatus: (model: string, status: string, count: number) =>
          `${model} · ${status} · ${count} 条 embedding`,
        coverage: (embeddingCount: number, candidateCount: number, ratio: string) =>
          `${embeddingCount} / ${candidateCount} · ${ratio}`,
        indexTotal: (count: number) => `索引总量：${count} 条 embedding`,
        coverageUnavailable: "Coverage 暂不可用",
        pendingJobs: (count: number) => `待处理 ${count}`,
        failedJobs: (count: number) => `失败 ${count}`,
        lastFailedAt: (value: string) => `最近失败：${value}`,
        lastError: (value: string) => `错误：${value}`,
        noJobFailures: "暂无 embedding job 失败。",
        rebuild: "重建向量索引",
        rebuilding: "已加入",
        backfill: "补齐缺失向量",
        backfilling: "已加入",
        notices: {
          saved: "Embedding provider 已保存。",
          tested: "连接测试成功。",
          deleted: "Embedding provider 已删除。",
          rebuildQueued: "Embedding index 重建已加入队列。",
          backfillQueued: "Embedding backfill 已加入队列。"
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
      retentionDays: "保留天数必须是 0 到 3650 的整数，0 表示永久。",
      cocoonLevel: "信息茧房水平必须是 1 到 10 的整数。"
    },
    units: {
      px: "px",
      days: "天",
      level: "级"
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
      recommended: "推荐",
      favorites: "收藏",
      read_later: "稍后读"
    },
    sort: {
      label: "排序",
      favorited_desc: "最近收藏",
      favorited_asc: "最早收藏",
      ranked: "个性化排序",
      read_later_desc: "最近加入",
      read_later_asc: "最早加入",
      published_desc: "最新发布",
      published_asc: "最早发布"
    },
    loadMore: "加载更多",
    loadingMore: "加载中",
    emptyNoFeedsTitle: "还没有订阅源",
    emptyNoFeedsBody: "添加一个 RSS / Atom 源后，文章会出现在这里。",
    emptyNoArticlesTitle: "暂时没有文章",
    emptyNoArticlesBody: "可以刷新订阅源，或切换到全部来源查看。",
    emptyNoUnreadTitle: "暂时没有未读文章",
    emptyNoUnreadBody: "关闭只看未读，可以查看已读或已忽略文章。",
    unreadOnly: "只看未读",
    filters: {
      label: "文章筛选",
      today: "今日",
      todayTitle: "只看今日文章",
      unreadTitle: "只看未读文章"
    },
    itemMeta: (date: string, feedTitle: string) => `${date} · ${feedTitle}`,
    state: {
      unseen: "新文章",
      ignored: "已忽略",
      opened: "已点进",
      reading: "阅读中",
      read: "读完",
      unread: "未读",
      favorited: "已收藏",
      liked: "已点赞",
      readLater: "稍后读"
    }
  },
  algorithmTransparency: {
    pageTitle: "算法透明说明",
    status: "算法说明已就绪",
    backToSettings: "返回设置",
    noWarnings: "暂无警告",
    sections: {
      currentStatus: "当前推荐状态",
      currentClusters: "当前兴趣簇",
      maintenance: "算法状态维护",
      mergeCandidates: "可能重复的兴趣簇",
      labelLexicon: "标签词典",
      algorithmExplanation: "算法解释",
      terms: "先解释几个词",
      scoreTable: "行为积分表",
      rankingFlow: "排序流程图",
      channelRules: "频道排序规则",
      dataAndFallback: "本地数据与 fallback"
    },
    statusTones: {
      normal: "正常",
      warning: "警告",
      stopped: "停摆",
      disabled: "未启用"
    },
    statusTable: {
      module: "模块",
      status: "状态",
      summary: "说明"
    },
    fields: {
      provider: "Provider",
      index: "Index",
      coverage: "Coverage",
      behaviorCounts: "行为计数",
      clusters: "兴趣簇",
      lastUpdates: "最近更新",
      warnings: "Warnings",
      cocoon: "信息茧房水平",
      exploration: "探索",
      formula: "当前公式",
      automaticMaintenance: "自动维护",
      failureStates: "Fallback / 任务状态"
    },
    clusters: {
      empty: "还没有形成兴趣簇。继续点赞、收藏、稍后读或读完文章后，系统会自动生成。",
      generated:
        "兴趣簇不是系统预设的，而是根据你的行为自动生成和更新。标签来自本地关键词、代表文章和来源标题，也可以手动重命名。",
      positive: "正向",
      negative: "负向",
      fallbackName: (index: number) => `兴趣簇 #${index}`,
      sourceLabel: "来源",
      source: {
        manual: "用户命名",
        keywords: "关键词自动生成",
        representative_titles: "代表文章自动推断",
        feeds: "来源标题自动推断",
        fallback: "自动 fallback"
      },
      confidenceLabel: "置信度",
      confidence: {
        high: "高",
        medium: "中",
        low: "低"
      },
      lowConfidence: "自动推断，可能不准",
      lowConfidenceAdvice: "自动标签置信度低，建议手动重命名。",
      collisionResolved: "该标签已自动加上区分词，以避免与其他兴趣簇重名。",
      possibleDuplicate: (label: string, similarity: string) =>
        `可能重复：与「${label}」相似度 ${similarity}`,
      autoInference: (label: string) => `自动推断：${label}`,
      evidence: (count: number) => `证据：${count} 篇文章`,
      generatedAt: (value: string) => `生成：${value}`,
      topTerms: "关键词",
      representativeArticles: "代表文章",
      feedTitles: "来源",
      rename: "重命名",
      renameLabel: "兴趣簇显示名称",
      renamePlaceholder: "例如：AI 编程代理",
      saveLabel: "保存名称",
      clearManualLabel: "恢复自动标签",
      cancelRename: "取消",
      details: (weight: string, sampleCount: number, updatedAt: string) =>
        `权重 ${weight} · 样本 ${sampleCount} · 更新 ${updatedAt}`,
      diagnostics: (
        supportArticleCount: number,
        sourceCount: number,
        strongSignalRatio: string,
        topSourceShare: string,
        averageSimilarity: string
      ) =>
        `诊断：支撑文章 ${supportArticleCount} · 来源 ${sourceCount} · 强信号 ${strongSignalRatio} · 最大来源占比 ${topSourceShare} · 平均相似度 ${averageSimilarity}`,
      risk: {
        low: "过拟合风险低",
        medium: "过拟合风险中",
        high: "过拟合风险高"
      },
      matched: (name: string, similarity: string, weight: string, sampleCount: number) =>
        `与你的兴趣簇「${name}」相似，相似度 ${similarity}，簇权重 ${weight}，样本 ${sampleCount}。`,
      openAll: "查看全部兴趣簇",
      allTitle: "全部兴趣簇",
      allSummary: (count: number) => `完整显示 ${count} 个兴趣簇，按权重从高到低排序。`,
      back: "返回算法透明说明"
    },
    mergeCandidates: {
      title: "可能重复的兴趣簇",
      body: "诊断只比较同一 polarity 的 active index 兴趣簇；合并会改变画像，因此默认需要手动确认。",
      empty: "当前没有打开状态的重复兴趣簇候选。",
      left: "左簇",
      right: "右簇",
      metrics: "指标",
      recommendation: "建议",
      actions: "操作",
      merge: "合并",
      ignore: "忽略",
      metricSummary: (centroid: string, label: string, evidence: string, score: string) =>
        `centroid ${centroid} · label ${label} · evidence ${evidence} · score ${score}`,
      recommendations: {
        auto_merge: "高置信",
        review: "需复核",
        ignore: "忽略"
      }
    },
    lexicon: {
      title: "标签词典",
      body: "噪声词、保护词和过滤规则只影响解释标签，不参与排序，也不会触发 embedding。",
      stopwordsAdd: "自定义噪声词",
      protectedTermsAdd: "自定义保护词",
      stopwordPlaceholder: "article / affiliation / URL 残留",
      addStopword: "添加噪声词",
      noStopwords: "尚未添加自定义噪声词。",
      saveAndRebuild: "保存并重建兴趣簇标签"
    },
    maintenance: {
      disclosureHint: "如系统运行正常，无需手动执行以下操作。",
      body:
        "这些任务只维护本地推荐状态。会请求 provider 的任务已单独标注；不确定时优先运行重算排序或近期意图重建。",
      run: "手动触发",
      running: "加入中",
      remoteUse: "外部请求",
      lastState: "最近状态",
      neverRun: "暂无记录",
      skipped: "跳过",
      notice: (label: string, existing: boolean) =>
        existing ? `${label} 已有任务在队列中。` : `${label} 已加入维护队列。`,
      tasks: {
        ranking_recalculate: {
          label: "重算排序",
          description: "重新计算推荐、稍后读等列表的本地排序分，不重新请求 embedding。",
          remoteUse: "不会调用 provider"
        },
        fingerprint_backfill: {
          label: "补齐文章指纹",
          description: "为缺少指纹的文章补齐标题/摘要指纹，供重复检测使用。",
          remoteUse: "不会调用 provider"
        },
        duplicate_rebuild: {
          label: "重建重复检测",
          description: "根据文章指纹重建重复组，减少相同主题或近重复文章挤占列表。",
          remoteUse: "不会调用 provider"
        },
        keyword_rebuild: {
          label: "重建关键词画像",
          description: "从本地行为和文章文本重建关键词画像，文章已清理时尽量使用快照。",
          remoteUse: "不会调用 provider"
        },
        cluster_label_rebuild: {
          label: "重建兴趣簇标签",
          description: "用本地证据文章、画像关键词和来源标题刷新兴趣簇显示标签。",
          remoteUse: "不会调用 provider"
        },
        cluster_merge_diagnostics: {
          label: "重建兴趣簇重复诊断",
          description: "只生成可能重复的兴趣簇候选，不修改画像和排序。",
          remoteUse: "不会调用 provider"
        },
        cluster_auto_merge: {
          label: "自动合并高置信重复簇",
          description: "仅在设置开启时合并高置信候选；合并会改变画像并触发排序重算。",
          remoteUse: "不会调用 provider"
        },
        recent_intent_rebuild: {
          label: "重建近期意图",
          description: "根据最近阅读行为刷新短期兴趣，用于近期推荐微调。",
          remoteUse: "不会调用 provider"
        },
        ftrl_train: {
          label: "训练本地排序模型",
          description: "用本地行为样本训练轻量排序模型，默认不自动提升为 active。",
          remoteUse: "不会调用 provider"
        },
        evaluation: {
          label: "运行排序评估",
          description: "用本地回放样本生成诊断指标，帮助判断推荐链路是否健康。",
          remoteUse: "不会调用 provider"
        },
        ftrl_promote: {
          label: "提升本地模型",
          description: "当样本质量足够时，把 shadow 模型以受限权重加入 active 排序。",
          remoteUse: "不会调用 provider"
        },
        ftrl_reset: {
          label: "重置本地模型",
          description: "清空 FTRL 训练权重和样本，仅用于模型状态明显异常时。",
          remoteUse: "不会调用 provider"
        }
      }
    },
    terms: [
      {
        term: "Embedding",
        description:
          "Embedding 是文章内容的向量表示。邸报用它比较文章和兴趣簇的语义距离；provider 只负责生成向量，不决定最终排序。"
      },
      {
        term: "用户模型卡",
        description:
          "邸报不会为每篇文章写一张静态卡片，而是把你的行为沉淀成一组正向/负向兴趣簇、来源偏好和文章状态。推荐排序时会拿候选文章向量与这些兴趣簇比较。"
      },
      {
        term: "兴趣簇",
        description:
          "兴趣簇是由相似文章向量合并出来的主题中心。点赞、收藏、稍后读、读完会增强正向兴趣簇；不感兴趣、隐藏会形成负向兴趣簇。"
      },
      {
        term: "Coverage",
        description:
          "Coverage 表示当前可排序文章中有多少已经生成 embedding。Coverage 不足时，新文章仍会进入列表，但会更多依赖新鲜度、来源和状态。"
      },
      {
        term: "基础排序",
        description:
          "没有 provider、没有 embedding 或画像还不足时，系统使用基础排序：主要看发布时间、来源权重和显式状态，不做语义相似度匹配。"
      },
      {
        term: "MMR",
        description:
          "MMR 用来在相似文章之间做轻量分散，避免同一主题连续占满推荐列表；信息茧房水平会影响它的分散强度。"
      }
    ],
    algorithmExplanation: [
      {
        name: "候选收集",
        role: "根据当前频道、来源、分组、未读/今日筛选和分页产生候选池。"
      },
      {
        name: "可见性过滤",
        role: "隐藏、不感兴趣、已删除文章会从普通列表中移除；收藏和稍后读频道保留各自队列语义。"
      },
      {
        name: "语义匹配",
        role: "有 active embedding index 时，计算候选文章与正向/负向兴趣簇的相似度。"
      },
      {
        name: "来源与新鲜度",
        role: "叠加手动来源权重、feed_stats 来源偏好和发布时间衰减，保证 RSS 时间线仍可解释。"
      },
      {
        name: "状态与负反馈",
        role: "收藏、点赞、稍后读、阅读进度提升短期排序；不感兴趣会清除其他状态并压低相似主题。"
      },
      {
        name: "去重与 MMR",
        role: "近重复、曝光和多样性惩罚会在最后阶段修正排序，减少重复主题挤占列表。"
      },
      {
        name: "Fallback",
        role: "当 provider、index、coverage 或画像不足时，系统退回基础排序，但阅读与列表仍可用。"
      }
    ],
    scoreTable: {
      columns: {
        behavior: "行为",
        modelCard: "用户模型卡积分",
        source: "来源偏好",
        ranking: "短期排序影响",
        notes: "说明"
      },
      rows: [
        {
          behavior: "滚过未打开 / 忽略",
          modelCard: "0",
          source: "-0.05",
          ranking: "-0.025，状态 -0.08",
          notes: "弱负反馈；表示这篇文章标题没有吸引你，不会单独创建负向兴趣簇。"
        },
        {
          behavior: "点进文章",
          modelCard: "0",
          source: "+0.02",
          ranking: "+0.005，状态 +0.015 到 +0.02",
          notes: "轻微正反馈；点进不等于读完，主要用于把已忽略文章恢复为已点进。"
        },
        {
          behavior: "阅读 25%",
          modelCard: "+1.2",
          source: "0",
          ranking: "+0.01",
          notes: "非常轻的兴趣信号，只记录最高档位的增量。"
        },
        {
          behavior: "阅读 50%",
          modelCard: "+2.0",
          source: "0",
          ranking: "+0.04",
          notes: "开始进入有效阅读信号。"
        },
        {
          behavior: "阅读 75%",
          modelCard: "+3.0",
          source: "0",
          ranking: "+0.06",
          notes: "强阅读信号。"
        },
        {
          behavior: "读完 / 90%",
          modelCard: "+4.0",
          source: "+1.0",
          ranking: "+0.10，已读状态 -0.08",
          notes: "说明主题有价值，但已读文章在当前推荐中会略降权，避免反复出现。"
        },
        {
          behavior: "加入稍后读",
          modelCard: "+3.0",
          source: "+1.0",
          ranking: "+0.08，状态 +0.08",
          notes: "稍后读是待读队列，列表内仍使用个性化排序。"
        },
        {
          behavior: "收藏",
          modelCard: "+6.0",
          source: "+2.0",
          ranking: "+0.12，状态 +0.04",
          notes: "收藏是资料库/书签信号；收藏频道默认不使用个性化排序。"
        },
        {
          behavior: "点赞",
          modelCard: "+8.0",
          source: "+3.0",
          ranking: "+0.16，状态 +0.10",
          notes: "最强正反馈，用来明确告诉系统你想看更多相似主题。"
        },
        {
          behavior: "取消点赞",
          modelCard: "-1.0",
          source: "-0.4",
          ranking: "-0.04",
          notes: "弱纠正信号；默认不创建新的强负向兴趣簇。"
        },
        {
          behavior: "不感兴趣",
          modelCard: "-6.0",
          source: "-2.5",
          ranking: "当前文章过滤，相似主题最多 -0.45",
          notes: "强负反馈，会创建负向兴趣簇并压低相似候选。"
        }
      ]
    },
    rankingFlowDiagram: [
      {
        phase: "候选",
        title: "收集候选",
        description: "频道、来源、分组、未读开关和分页共同决定候选池。"
      },
      {
        phase: "过滤",
        title: "移除不可见项",
        description: "隐藏、不感兴趣、已删除文章退出普通列表。"
      },
      {
        phase: "状态",
        title: "读取文章状态",
        description: "收藏、点赞、稍后读、阅读深度、忽略和点进进入 state score。"
      },
      {
        phase: "来源",
        title: "计算来源偏好",
        description: "手动来源权重与 feed_stats 合成 source score。"
      },
      {
        phase: "时间",
        title: "计算新鲜度",
        description: "用发布时间或发现时间计算 freshness score，半衰期约 36 小时。"
      },
      {
        phase: "模型",
        title: "匹配用户模型卡",
        description: "有 active embedding index 时，文章向量会匹配正/负兴趣簇。"
      },
      {
        phase: "合成",
        title: "融合排序分",
        description: "兴趣、来源、新鲜度、状态与负向惩罚合成 active rank score。"
      },
      {
        phase: "输出",
        title: "按频道输出",
        description: "最新按时间；推荐和稍后读按个性化分；收藏默认按收藏时间。"
      }
    ],
    channelRules: [
      "最新：默认按时间倒序。只看未读开关只过滤派生未读状态，不改变排序语义。",
      "推荐：使用个性化排序。没有模型卡或 embedding 时自动 fallback 到基础排序。",
      "稍后读：只显示稍后读文章，但仍使用个性化排序，适合当待读队列。",
      "收藏：是资料库/书签。默认按收藏时间倒序，可切换收藏时间或发布时间排序，不使用个性化排序。"
    ],
    copy: {
      localData:
        "本地保存原始行为事件、文章状态、阅读进度、来源偏好、兴趣簇、embedding provider 配置和索引状态。API key 当前按本地自托管策略保存在 SQLite 中。",
      fallback:
        "当 provider 未配置、索引 coverage 不足、provider 请求失败、文章缺少 embedding、或诊断状态不可用时，系统会 fallback 到基础排序。fallback 不会阻塞阅读。"
    }
  },
  recommendationStatus: {
    title: "推荐状态",
    loading: "正在读取推荐状态",
    fallback: "推荐状态暂不可用，当前列表仍可阅读。",
    modes: {
      baseline: "基础排序中",
      personalized: "个性化推荐中",
      embedding: "Embedding 生成中",
      degraded: "Provider 异常，已 fallback"
    },
    metrics: {
      behaviorCount: (count: number) => `行为 ${count}`,
      coverage: (ratio: string) => `Coverage ${ratio}`,
      clusters: (positive: number, negative: number) => `兴趣簇 +${positive} / -${negative}`,
      lastUpdate: (ranking: string, profile: string) => `排序 ${ranking} · 画像 ${profile}`,
      unknown: "暂无"
    }
  },
  reader: {
    originalLink: "原文",
    backToList: "返回列表",
    selectArticleTitle: "选择一篇文章",
    selectArticleBody: "文章详情会在这里打开。",
    feedOnlyNotice: "当前仅有订阅源摘要。",
    noContent: "这篇文章暂无正文内容。",
    meta: (feedTitle: string, date?: string, author?: string | null) =>
      [feedTitle, date, author].filter(Boolean).join(" · ")
  },
  explanation: {
    title: "为什么推荐",
    entryTitle: "推荐解释",
    open: "查看完整理由",
    teaser: "只展示可理解的理由，不暴露内部原始分数。",
    sortLabel: "当前排序说明",
    sortTitle: "当前视图排序",
    loading: "正在生成推荐解释",
    empty: "当前没有明确的推荐信号。",
    generatedAt: (date: string) => `生成于 ${date}`,
    sorting: {
      latest: "当前视图正按照发布时间排序。",
      recommended: "推荐视图会综合用户模型卡、来源偏好、新鲜度和文章状态排序。",
      favorites: "收藏视图默认按收藏时间排序，不使用个性化推荐分。",
      read_later: "稍后读视图仍使用个性化排序，帮助你优先处理更可能值得阅读的文章。"
    },
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
      interestCluster: (summary: string) => `与你近期的正向兴趣相似，因此排序更靠前。${summary}`,
      sourcePositive: (label: string) => `来源 ${label} 对排序有正向影响。`,
      sourceNegative: (label: string) => `来源 ${label} 当前权重偏低。`,
      freshness: "文章较新，获得新鲜度加分。",
      statePositive: "收藏、稍后读或阅读进度提高了排序。",
      stateNegative: "忽略、读完等状态降低了排序优先级。",
      fallback: "当前使用基础排序，暂时没有更强的推荐信号。",
      negative: "近期负向行为降低了排序。",
      penalty: "隐藏或不感兴趣会显著降低排序。"
    }
  },
  actions: {
    favorite: "收藏",
    unfavorite: "取消收藏",
    like: "点赞",
    unlike: "取消点赞",
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
      like: "点赞这篇文章",
      unlike: "取消点赞这篇文章",
      readLater: "稍后读这篇文章",
      removeReadLater: "移出稍后读",
      markRead: "标记这篇文章为已读",
      markUnread: "标记这篇文章为未读",
      notInterested: "不再推荐类似文章",
      notInterestedActive: "已标记不感兴趣",
      group: "文章操作"
    },
    errors: {
      favorite: "收藏失败。",
      like: "点赞更新失败。",
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
    close: "Close",
    version: (version: string) => `v${version}`
  },
  navigation: {
    ariaLabel: "Primary navigation",
    items: {
      latest: "Latest",
      recommended: "Recommended",
      favorites: "Favorites",
      read_later: "Read Later",
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
      recommended: "Recommended Articles",
      favorites: "Favorite Articles",
      read_later: "Read Later"
    },
    loadingArticles: "Loading articles",
    latestView: "Latest view",
    viewStatus: {
      latest: "Latest view",
      recommended: "Recommended view",
      favorites: "Favorites view",
      read_later: "Read-later view"
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
    nextRefreshAt: (date: string) => `Next fetch: ${date}`,
    refresh: "Refresh",
    refreshing: "…",
    refreshAll: "Refresh all",
    refreshingAll: "Queueing",
    openSources: "Sources",
    openSourcesLabel: "Open sources",
    closeSources: "Close sources",
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
    operations: {
      kicker: "Operations",
      title: "Import, export, and refresh"
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
      nextRefresh: (value: string) => `Next fetch: ${value}`,
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
      nextRefreshAt: "Next fetch",
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
        enUS: "English",
        defaultHomeViewLabel: "Default home view",
        defaultHomeViewRecommended: "Recommended",
        defaultHomeViewLatest: "Latest"
      },
      behavior: {
        title: "Behavior tracking",
        body: "Control automatic behavior capture for browsing lists and the read-later queue.",
        algorithmTransparencyLink: "View algorithm transparency",
        markScrolledArticlesIgnored: "Mark unopened scrolled-past articles as ignored and remove them from unread",
        removeReadLaterOnReadComplete: "Remove read-later articles after completed reading",
        cocoonLevel: "Cocoon level",
        cocoonLevelHint: "1 is more open, distributed, and exploratory; 10 is more personalized, stable, and less disruptive. Every level still ranks only your subscribed feeds and respects dedupe plus explicit negative feedback."
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
        body: "Background cleanup removes articles older than the retention window. Use 0 to keep articles forever. Favorites and read-later items can be kept independently.",
        retentionDays: "Retention days",
        keepFavorites: "Keep favorited articles",
        keepReadLater: "Keep read-later articles",
        enabled: "On",
        disabled: "Off",
        mappingHint: "API field retention.retentionDays is stored as storage key retention.articleDays."
      },
      provider: {
        title: "Intelligence",
        body: "Configure an OpenAI-compatible or Ollama embedding provider. Without an enabled provider, Dibao keeps using baseline ranking.",
        loading: "Loading intelligence settings",
        providerLabel: "Provider",
        newProvider: "New embedding provider",
        typeLabel: "Type",
        openaiCompatible: "OpenAI-compatible",
        ollama: "Ollama",
        nameLabel: "Name",
        baseUrlLabel: "Base URL",
        baseUrlPlaceholder: "https://api.example.com/v1",
        ollamaBaseUrlPlaceholder: "http://127.0.0.1:11434",
        modelLabel: "Model",
        modelPlaceholder: "text-embedding-3-small",
        ollamaModelPlaceholder: "nomic-embed-text",
        dimensionLabel: "Dimension",
        apiKeyLabel: "API Key",
        apiKeyPlaceholder: "Optional, depending on the endpoint",
        apiKeyRetainPlaceholder: "Leave blank to keep the saved key",
        ollamaApiKeyHint: "The local Ollama API does not require an API key by default.",
        modelHint: "Use any configured embedding model. For Ollama, enter the local model name and dimension, for example bge-m3 / 1024.",
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
        connectionStatusTitle: "Connection test status",
        embeddingJobStatusTitle: "Embedding job status",
        indexesBody: "Indexes show coverage, queue state, and recent failures. Connection tests and embedding jobs are reported separately.",
        usageWindowLabel: "Embedding usage window",
        usageWindows: {
          "24h": "24H",
          "7d": "7Days",
          "30d": "30Days"
        },
        usage: (requestCount: number, estimatedTokens: number) =>
          `Local estimate: ${requestCount} requests · ${estimatedTokens} tokens`,
        noIndexes: "Saving and enabling a provider creates an active index.",
        indexStatus: (model: string, status: string, count: number) =>
          `${model} · ${status} · ${count} ${count === 1 ? "embedding" : "embeddings"}`,
        coverage: (embeddingCount: number, candidateCount: number, ratio: string) =>
          `${embeddingCount} / ${candidateCount} · ${ratio}`,
        indexTotal: (count: number) => `Index total: ${count} ${count === 1 ? "embedding" : "embeddings"}`,
        coverageUnavailable: "Coverage unavailable",
        pendingJobs: (count: number) => `${count} pending`,
        failedJobs: (count: number) => `${count} failed`,
        lastFailedAt: (value: string) => `Last failed: ${value}`,
        lastError: (value: string) => `Error: ${value}`,
        noJobFailures: "No embedding job failures.",
        rebuild: "Rebuild vector index",
        rebuilding: "Queued",
        backfill: "Backfill missing vectors",
        backfilling: "Queued",
        notices: {
          saved: "Embedding provider saved.",
          tested: "Connection test succeeded.",
          deleted: "Embedding provider deleted.",
          rebuildQueued: "Embedding index rebuild queued.",
          backfillQueued: "Embedding backfill queued."
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
      retentionDays: "Retention days must be an integer between 0 and 3650; 0 means forever.",
      cocoonLevel: "Cocoon level must be an integer from 1 to 10."
    },
    units: {
      px: "px",
      days: "days",
      level: "level"
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
      recommended: "Recommended",
      favorites: "Favorites",
      read_later: "Read Later"
    },
    sort: {
      label: "Sort",
      favorited_desc: "Recently favorited",
      favorited_asc: "Oldest favorited",
      ranked: "Personalized",
      read_later_desc: "Recently added",
      read_later_asc: "Oldest added",
      published_desc: "Newest published",
      published_asc: "Oldest published"
    },
    loadMore: "Load more",
    loadingMore: "Loading",
    emptyNoFeedsTitle: "No feeds yet",
    emptyNoFeedsBody: "Add an RSS / Atom feed and articles will appear here.",
    emptyNoArticlesTitle: "No articles yet",
    emptyNoArticlesBody: "Refresh a feed or switch back to all sources.",
    emptyNoUnreadTitle: "No unread articles",
    emptyNoUnreadBody: "Turn off Only unread to see read or ignored articles.",
    unreadOnly: "Only unread",
    filters: {
      label: "Article filters",
      today: "Today",
      todayTitle: "Only today's articles",
      unreadTitle: "Only unread articles"
    },
    itemMeta: (date: string, feedTitle: string) => `${date} · ${feedTitle}`,
    state: {
      unseen: "New",
      ignored: "Ignored",
      opened: "Opened",
      reading: "Reading",
      read: "Finished",
      unread: "Unread",
      favorited: "Favorited",
      liked: "Liked",
      readLater: "Read later"
    }
  },
  algorithmTransparency: {
    pageTitle: "Algorithm Transparency",
    status: "Algorithm notes ready",
    backToSettings: "Back to settings",
    noWarnings: "No warnings",
    sections: {
      currentStatus: "Current recommendation status",
      currentClusters: "Current interest clusters",
      maintenance: "Algorithm maintenance",
      mergeCandidates: "Possible duplicate clusters",
      labelLexicon: "Label lexicon",
      algorithmExplanation: "Algorithm explanation",
      terms: "Terms",
      scoreTable: "Behavior score table",
      rankingFlow: "Ranking flow",
      channelRules: "Channel rules",
      dataAndFallback: "Local data and fallback"
    },
    statusTones: {
      normal: "Normal",
      warning: "Warning",
      stopped: "Stopped",
      disabled: "Disabled"
    },
    statusTable: {
      module: "Module",
      status: "Status",
      summary: "Summary"
    },
    fields: {
      provider: "Provider",
      index: "Index",
      coverage: "Coverage",
      behaviorCounts: "Behavior counts",
      clusters: "Clusters",
      lastUpdates: "Last updates",
      warnings: "Warnings",
      cocoon: "Cocoon level",
      exploration: "Exploration",
      formula: "Current formula",
      automaticMaintenance: "Automatic maintenance",
      failureStates: "Fallback / task states"
    },
    clusters: {
      empty: "No interest clusters have formed yet. Likes, favorites, read-later saves, and completed reads will generate them automatically.",
      generated:
        "Interest clusters are not preset by the system. Labels come from local keywords, representative articles, and feed titles, and can be renamed manually.",
      positive: "Positive",
      negative: "Negative",
      fallbackName: (index: number) => `Interest cluster #${index}`,
      sourceLabel: "Source",
      source: {
        manual: "User named",
        keywords: "Keyword inference",
        representative_titles: "Representative-title inference",
        feeds: "Feed-title inference",
        fallback: "Automatic fallback"
      },
      confidenceLabel: "Confidence",
      confidence: {
        high: "High",
        medium: "Medium",
        low: "Low"
      },
      lowConfidence: "Automatic inference, may be inaccurate",
      lowConfidenceAdvice: "Automatic label confidence is low; consider renaming manually.",
      collisionResolved: "This label was automatically disambiguated to avoid duplicate cluster names.",
      possibleDuplicate: (label: string, similarity: string) =>
        `Possible duplicate: similar to "${label}" at ${similarity}`,
      autoInference: (label: string) => `Auto inference: ${label}`,
      evidence: (count: number) => `Evidence: ${count} articles`,
      generatedAt: (value: string) => `Generated: ${value}`,
      topTerms: "Keywords",
      representativeArticles: "Representative articles",
      feedTitles: "Feeds",
      rename: "Rename",
      renameLabel: "Cluster display name",
      renamePlaceholder: "For example: AI coding agents",
      saveLabel: "Save name",
      clearManualLabel: "Restore automatic label",
      cancelRename: "Cancel",
      details: (weight: string, sampleCount: number, updatedAt: string) =>
        `Weight ${weight} · samples ${sampleCount} · updated ${updatedAt}`,
      diagnostics: (
        supportArticleCount: number,
        sourceCount: number,
        strongSignalRatio: string,
        topSourceShare: string,
        averageSimilarity: string
      ) =>
        `Diagnostics: support articles ${supportArticleCount} · sources ${sourceCount} · strong signals ${strongSignalRatio} · top-source share ${topSourceShare} · average similarity ${averageSimilarity}`,
      risk: {
        low: "Low overfit risk",
        medium: "Medium overfit risk",
        high: "High overfit risk"
      },
      matched: (name: string, similarity: string, weight: string, sampleCount: number) =>
        `Similar to your interest cluster "${name}", similarity ${similarity}, cluster weight ${weight}, samples ${sampleCount}.`,
      openAll: "View all interest clusters",
      allTitle: "All interest clusters",
      allSummary: (count: number) => `Showing all ${count} interest clusters, sorted by weight.`,
      back: "Back to transparency"
    },
    mergeCandidates: {
      title: "Possible duplicate clusters",
      body: "Diagnostics only compare same-polarity clusters in the active index. Merge changes the profile, so it requires confirmation by default.",
      empty: "No open duplicate-cluster candidates.",
      left: "Left cluster",
      right: "Right cluster",
      metrics: "Metrics",
      recommendation: "Recommendation",
      actions: "Actions",
      merge: "Merge",
      ignore: "Ignore",
      metricSummary: (centroid: string, label: string, evidence: string, score: string) =>
        `centroid ${centroid} · label ${label} · evidence ${evidence} · score ${score}`,
      recommendations: {
        auto_merge: "High confidence",
        review: "Review",
        ignore: "Ignore"
      }
    },
    lexicon: {
      title: "Label lexicon",
      body: "Stopwords, protected terms, and filters affect explainability labels only; they do not affect ranking or request embeddings.",
      stopwordsAdd: "Custom stopwords",
      protectedTermsAdd: "Custom protected terms",
      stopwordPlaceholder: "article / affiliation / URL residue",
      addStopword: "Add stopword",
      noStopwords: "No custom stopwords yet.",
      saveAndRebuild: "Save and rebuild cluster labels"
    },
    maintenance: {
      disclosureHint: "If the system is running normally, you do not need to run these manually.",
      body:
        "These tasks maintain local recommendation state. Tasks that might call the provider are called out separately; when unsure, start with ranking recalculation or recent intent rebuild.",
      run: "Run",
      running: "Queueing",
      remoteUse: "Remote use",
      lastState: "Last state",
      neverRun: "No record",
      skipped: "Skipped",
      notice: (label: string, existing: boolean) =>
        existing ? `${label} already has an open job.` : `${label} was queued.`,
      tasks: {
        ranking_recalculate: {
          label: "Recalculate ranking",
          description: "Recomputes local ranking scores for recommendation and read-later lists without requesting embeddings.",
          remoteUse: "Does not call provider"
        },
        fingerprint_backfill: {
          label: "Backfill fingerprints",
          description: "Adds missing title and summary fingerprints used by duplicate detection.",
          remoteUse: "Does not call provider"
        },
        duplicate_rebuild: {
          label: "Rebuild duplicates",
          description: "Rebuilds duplicate groups from article fingerprints to reduce repeated topics.",
          remoteUse: "Does not call provider"
        },
        keyword_rebuild: {
          label: "Rebuild keyword profile",
          description: "Rebuilds the keyword profile from local behavior and article text, using snapshots when articles were cleaned up.",
          remoteUse: "Does not call provider"
        },
        cluster_label_rebuild: {
          label: "Rebuild cluster labels",
          description: "Refreshes cluster display labels from local evidence articles, profile keywords, and feed titles.",
          remoteUse: "Does not call provider"
        },
        cluster_merge_diagnostics: {
          label: "Rebuild cluster merge diagnostics",
          description: "Generates possible duplicate-cluster candidates without changing the profile or ranking.",
          remoteUse: "Does not call provider"
        },
        cluster_auto_merge: {
          label: "Auto-merge high-confidence clusters",
          description: "Only runs when enabled; merging changes the profile and triggers ranking recalculation.",
          remoteUse: "Does not call provider"
        },
        recent_intent_rebuild: {
          label: "Rebuild recent intent",
          description: "Refreshes short-term interests from recent reading behavior.",
          remoteUse: "Does not call provider"
        },
        ftrl_train: {
          label: "Train local ranker",
          description: "Trains the lightweight local ranking model from behavior samples without automatically promoting it.",
          remoteUse: "Does not call provider"
        },
        evaluation: {
          label: "Run ranking evaluation",
          description: "Runs local replay diagnostics to check whether the recommendation chain is healthy.",
          remoteUse: "Does not call provider"
        },
        ftrl_promote: {
          label: "Promote local model",
          description: "Adds the shadow model to active ranking with capped weight when sample quality is sufficient.",
          remoteUse: "Does not call provider"
        },
        ftrl_reset: {
          label: "Reset local model",
          description: "Clears FTRL weights and samples; use only when model state is clearly wrong.",
          remoteUse: "Does not call provider"
        }
      }
    },
    terms: [
      {
        term: "Embedding",
        description:
          "An embedding is the vector representation of article content. Dibao uses it to compare articles with interest clusters; the provider generates vectors but does not decide the final ranking."
      },
      {
        term: "User profile card",
        description:
          "Dibao does not write one static card per article. It turns your behavior into positive and negative interest clusters, source preferences, and article state. Ranking compares candidate article vectors with those clusters."
      },
      {
        term: "Interest cluster",
        description:
          "An interest cluster is a topic centroid merged from similar article vectors. Likes, favorites, read-later saves, and completed reads strengthen positive clusters; not-interested and hidden actions create negative clusters."
      },
      {
        term: "Coverage",
        description:
          "Coverage means how many rankable articles already have embeddings. When coverage is low, new articles can still appear, but Dibao relies more on freshness, source, and state."
      },
      {
        term: "Baseline ranking",
        description:
          "When there is no provider, no embedding, or not enough profile signal, Dibao uses baseline ranking: time, source weight, and explicit article state, without semantic similarity matching."
      },
      {
        term: "MMR",
        description:
          "MMR lightly diversifies similar articles so one topic does not fill the list. Cocoon level changes how much diversity is applied."
      }
    ],
    algorithmExplanation: [
      {
        name: "Candidate collection",
        role: "Builds the candidate pool from channel, source, folder, unread/today filters, and pagination."
      },
      {
        name: "Visibility filter",
        role: "Hidden, not-interested, and deleted articles leave normal lists while favorites and read-later keep their queue semantics."
      },
      {
        name: "Semantic matching",
        role: "When an active embedding index exists, compares candidate articles with positive and negative interest clusters."
      },
      {
        name: "Source and freshness",
        role: "Combines manual source weight, feed_stats source preference, and time decay so the RSS timeline remains explainable."
      },
      {
        name: "State and negative feedback",
        role: "Favorites, likes, read-later saves, and reading progress boost ranking; not interested clears other states and lowers similar topics."
      },
      {
        name: "Dedupe and MMR",
        role: "Near-duplicate, exposure, and diversity corrections are applied near the end to reduce repeated topics."
      },
      {
        name: "Fallback",
        role: "If provider, index, coverage, or profile data is insufficient, Dibao falls back to baseline ranking while reading remains available."
      }
    ],
    scoreTable: {
      columns: {
        behavior: "Behavior",
        modelCard: "Profile score",
        source: "Source preference",
        ranking: "Short-term ranking",
        notes: "Notes"
      },
      rows: [
        {
          behavior: "Scrolled past unopened / ignored",
          modelCard: "0",
          source: "-0.05",
          ranking: "-0.025, state -0.08",
          notes: "Weak negative signal. It means the title did not attract you; it does not create a negative cluster by itself."
        },
        {
          behavior: "Opened article",
          modelCard: "0",
          source: "+0.02",
          ranking: "+0.005, state +0.015 to +0.02",
          notes: "Very light positive signal. Opening is not the same as reading; it mainly restores an ignored article to opened."
        },
        {
          behavior: "Read 25%",
          modelCard: "+1.2",
          source: "0",
          ranking: "+0.01",
          notes: "Very light interest signal. Dibao only applies the highest progress-tier delta."
        },
        {
          behavior: "Read 50%",
          modelCard: "+2.0",
          source: "0",
          ranking: "+0.04",
          notes: "Starts to count as meaningful reading."
        },
        {
          behavior: "Read 75%",
          modelCard: "+3.0",
          source: "0",
          ranking: "+0.06",
          notes: "Strong reading signal."
        },
        {
          behavior: "Completed / 90%",
          modelCard: "+4.0",
          source: "+1.0",
          ranking: "+0.10, read state -0.08",
          notes: "Shows the topic was valuable, but finished articles are slightly lowered so they do not keep resurfacing."
        },
        {
          behavior: "Save for later",
          modelCard: "+3.0",
          source: "+1.0",
          ranking: "+0.08, state +0.08",
          notes: "Read later is a to-read queue, and the page still uses personalized ranking."
        },
        {
          behavior: "Favorite",
          modelCard: "+6.0",
          source: "+2.0",
          ranking: "+0.12, state +0.04",
          notes: "Favorites are library/bookmark signals. The favorites channel does not use personalized sorting by default."
        },
        {
          behavior: "Like",
          modelCard: "+8.0",
          source: "+3.0",
          ranking: "+0.16, state +0.10",
          notes: "The strongest positive signal. It explicitly asks for more similar topics."
        },
        {
          behavior: "Unlike",
          modelCard: "-1.0",
          source: "-0.4",
          ranking: "-0.04",
          notes: "Weak correction. It does not create a new strong negative cluster by default."
        },
        {
          behavior: "Not interested",
          modelCard: "-6.0",
          source: "-2.5",
          ranking: "Current article filtered, similar topics up to -0.45",
          notes: "Strong negative feedback. It creates a negative cluster and lowers similar candidates."
        }
      ]
    },
    rankingFlowDiagram: [
      {
        phase: "Candidates",
        title: "Collect candidates",
        description: "Channel, source, folder, unread filter, and cursor form the candidate pool."
      },
      {
        phase: "Filter",
        title: "Remove invisible items",
        description: "Hidden, not-interested, and deleted articles leave normal lists."
      },
      {
        phase: "State",
        title: "Read article state",
        description: "Favorite, like, read later, depth, ignored, and opened feed into state score."
      },
      {
        phase: "Source",
        title: "Calculate source preference",
        description: "Manual source weight and feed_stats are combined into source score."
      },
      {
        phase: "Time",
        title: "Calculate freshness",
        description: "Published or discovered time drives freshness score with a roughly 36-hour half-life."
      },
      {
        phase: "Profile",
        title: "Match the profile card",
        description: "With an active embedding index, vectors match positive and negative interest clusters."
      },
      {
        phase: "Blend",
        title: "Blend ranking score",
        description: "Interest, source, freshness, state, and negative penalty form the active rank score."
      },
      {
        phase: "Output",
        title: "Return by channel",
        description: "Latest uses time; recommended and read later use personalization; favorites use saved time."
      }
    ],
    channelRules: [
      "Latest: time-descending by default. Only unread filters derived unread state without changing the sort meaning.",
      "Recommended: personalized ranking. If the profile card or embeddings are missing, Dibao falls back to baseline ranking.",
      "Read later: shows only read-later articles, but still uses personalized ranking as a to-read queue.",
      "Favorites: library/bookmark mode. It defaults to favorited time descending and can switch between favorited time and published time; it does not use personalized ranking."
    ],
    copy: {
      localData:
        "Dibao stores raw behavior events, article state, reading progress, source preference, interest clusters, embedding provider configuration, and index status locally. API keys currently use the MVP local SQLite storage strategy.",
      fallback:
        "Dibao falls back to baseline ranking when a provider is not configured, index coverage is low, provider requests fail, an article has no embedding, or diagnostics are unavailable. Fallback never blocks reading."
    }
  },
  recommendationStatus: {
    title: "Recommendation status",
    loading: "Loading recommendation status",
    fallback: "Recommendation status is unavailable; the list is still readable.",
    modes: {
      baseline: "Baseline ranking",
      personalized: "Personalized recommendations enabled",
      embedding: "Generating embeddings",
      degraded: "Provider issue, fallback active"
    },
    metrics: {
      behaviorCount: (count: number) => `${count} behaviors`,
      coverage: (ratio: string) => `Coverage ${ratio}`,
      clusters: (positive: number, negative: number) => `Clusters +${positive} / -${negative}`,
      lastUpdate: (ranking: string, profile: string) => `Rank ${ranking} · Profile ${profile}`,
      unknown: "Unavailable"
    }
  },
  reader: {
    originalLink: "Original",
    backToList: "Back to list",
    selectArticleTitle: "Select an article",
    selectArticleBody: "Article details will open here.",
    feedOnlyNotice: "Only the feed summary is available.",
    noContent: "This article has no body content yet.",
    meta: (feedTitle: string, date?: string, author?: string | null) =>
      [feedTitle, date, author].filter(Boolean).join(" · ")
  },
  explanation: {
    title: "Why recommended",
    entryTitle: "Recommendation explanation",
    open: "View full reasons",
    teaser: "Shows understandable reasons without exposing raw internal scores.",
    sortLabel: "Current sorting note",
    sortTitle: "Current view sorting",
    loading: "Generating recommendation explanation",
    empty: "No clear recommendation signal yet.",
    generatedAt: (date: string) => `Generated ${date}`,
    sorting: {
      latest: "This view is currently sorted by published time.",
      recommended: "Recommended combines your profile card, source preference, freshness, and article state.",
      favorites: "Favorites are sorted by saved time by default and do not use personalized ranking.",
      read_later: "Read later still uses personalized ranking so likely useful items can rise first."
    },
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
      interestCluster: (summary: string) =>
        `This is similar to recent positive interests, so it ranks higher. ${summary}`,
      sourcePositive: (label: string) => `Source ${label} is helping this rank higher.`,
      sourceNegative: (label: string) => `Source ${label} currently has a lower weight.`,
      freshness: "The article is recent and receives a freshness boost.",
      statePositive: "Favorite, read later, or reading progress raised the rank.",
      stateNegative: "Ignored, finished, and similar states lowered its priority.",
      fallback: "Baseline ranking is active and no stronger signal is available yet.",
      negative: "Recent negative behavior lowered the rank.",
      penalty: "Hidden or not interested state strongly lowers the rank."
    }
  },
  actions: {
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    like: "Like",
    unlike: "Unlike",
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
      like: "Like this article",
      unlike: "Unlike this article",
      readLater: "Save this article for later",
      removeReadLater: "Remove this article from read later",
      markRead: "Mark this article as read",
      markUnread: "Mark this article as unread",
      notInterested: "Stop recommending similar articles",
      notInterestedActive: "Already marked not interested",
      group: "Article actions"
    },
    errors: {
      favorite: "Favorite failed.",
      like: "Like update failed.",
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
