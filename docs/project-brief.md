# 邸报 Dibao 项目草案

## 项目名称

中文名：邸报

英文名：Dibao

## 相关文档

- [MVP PRD](./mvp-prd.md)
- [工程蓝图](./engineering-blueprint.md)
- [数据库 Schema](./database-schema.md)
- [API Contract](./api-contract.md)
- [低保真页面线框](./wireframes.md)
- [Design Tokens](./design-tokens.md)
- [视觉与交互设计规范 v0](./visual-interaction-spec-v0.md)
- [文章行为动作交互微规格 v0](./article-actions-interaction-v0.md)
- [Profile Algorithm v0 参数表](./profile-algorithm-v0.md)
- [sqlite-vec Node.js 集成验证](./spikes/sqlite-vec-node.md)

## 项目定位

邸报 Dibao 是一个开源、可自托管、个人可控的个性化 RSS 信息流系统。

它不是要再造一个平台型内容分发系统，而是把“算法推荐”限制在用户自己明确订阅的信源范围内。用户决定信息来源，系统只负责在这些来源内部做个性化排序、去重、检索和阅读体验优化。

核心差异：

- 用户自主管理 RSS / Atom 订阅源。
- 推荐只发生在用户订阅源内部。
- 推荐逻辑尽量可解释、可调节、可迁移。
- 项目开源，支持自托管，用户可以掌握自己的数据。
- 不以平台增长、广告或内容扩张为目标。

一句话描述：

> 一个自托管优先的个人推荐 RSS 系统，把今日头条式排序能力放回用户自己的信源和服务器里。

## 目标用户

长期目标是尽量服务普通用户，而不是只服务开发者或极客用户。

邸报是单用户个人信息系统，不面向团队协作场景，也不计划支持多用户账户体系。一个部署实例服务一个用户。

邸报不以官方托管服务作为长期目标。项目重点是开源、自托管和个人数据自控，而不是运营一个多用户云服务。

在工程路线早期，项目会优先满足愿意部署自托管服务的用户，包括：

- RSS 重度用户
- 新闻、研究、技术、投资等信息密集型用户
- 希望摆脱平台推荐但又需要排序辅助的用户
- 关心数据所有权和开源可控性的用户

## 产品形态

当前共识是采用服务端优先的前后端分离架构。

服务端本身同时提供：

- 后台任务能力
- API
- Web App 前台
- RSS 抓取与正文抽取
- embedding 与推荐排序
- 多端同步的数据中心

服务端是单用户服务端。它可以服务用户自己的多个客户端，但不提供多用户租户、团队空间、组织权限或公共社交关系。

客户端包括：

- 桌面浏览器 Web App
- Mobile Web / PWA
- 后续 iPhone App
- 后续 Android App
- 后续桌面 App

iPhone、Android 和桌面 App 可以优先复用 Web 前端代码，例如通过 PWA 或 Capacitor 一类方案打包。原生能力只在确有必要时逐步补充。

## 为什么不以纯移动端本地计算为主线

最初设想中，iPhone / Android 客户端可以完全本地运行 RSS 抓取、embedding 和推荐排序。

但移动端，尤其是 iOS，对后台运行有明显限制。用户打开 App 时才有较稳定的前台计算时间，而用户打开 App 时又希望立刻看到已经排序好的新文章。若把 embedding 和排序都放在移动端本地，会带来明显体验风险：

- 新文章未 embedding 时无法精排。
- iOS 后台任务不可作为稳定计算保障。
- 首次导入或大量新增文章时容易造成卡顿、耗电和发热。
- 多端同步会变得更复杂。

因此当前主路线调整为：

> 服务端负责抓取、embedding、排序和同步；客户端负责阅读、反馈和少量缓存。

这会牺牲一部分“纯移动端单机使用”的用户，但显著降低工程复杂度，并提升普通用户打开即用的体验。

## 演进路线

### 阶段一：Web App + Server

先完成一个完整的自托管 Web 产品。

服务端负责：

- RSS / Atom 订阅源管理
- 定时抓取
- 正文抽取
- 去重
- embedding 生成
- 推荐排序
- 行为记录
- 阅读状态、收藏、稍后读
- Web App 前台

### 阶段二：PWA

让 Web App 在 iPhone 和 Android 上具备较好的移动端体验：

- 添加到主屏幕
- 移动端布局
- 基础离线缓存
- 基础通知能力

### 阶段三：移动端 App

通过复用 Web 前端代码打包 iOS / Android App。

优先考虑：

- Capacitor
- 其他 WebView 打包方案

原生能力按需增加，例如：

- 系统分享扩展
- 推送通知
- 更好的本地缓存
- 系统级阅读体验优化

### 阶段四：增强本地能力

在核心产品成立后，再考虑：

- 桌面本地版本
- 可选本地 embedding
- 更强离线阅读
- 无服务器轻量模式

这不是第一阶段目标。

## 移动端路线

移动端路线选择：

> PWA first, Capacitor later

第一阶段不单独开发原生 iOS / Android App，也不引入 React Native 或 Flutter。

第一阶段要求 Web App 从一开始适配移动端，并支持 PWA：

- 手机浏览器访问
- 添加到主屏幕
- 全屏应用体验
- 移动端阅读布局
- 基础离线缓存
- 基础通知能力

后续如需要应用商店分发或更强系统能力，再通过 Capacitor 将同一套 Web 前端打包成 iOS / Android App。

Capacitor 后续主要用于：

- App Store / Play Store 分发
- 推送通知
- 系统分享扩展
- 更好的本地缓存
- 其他必要原生能力

不计划在早期重写一套独立移动端前端。

## 数据库选型共识

当前不希望默认使用 Postgres。

原因：

- Postgres 对普通自托管用户部署成本偏高。
- 备份、升级、连接池、权限和 Docker 编排都更重。
- 本项目早期更重视低门槛部署，而不是大型系统架构完整性。

当前默认方案：

> SQLite + FTS5 + sqlite-vec

SQLite 负责：

- 用户数据
- 订阅源
- 文章
- 阅读状态
- 收藏 / 稍后读
- 行为日志
- 排序分缓存
- 全文搜索

FTS5 负责：

- 标题 / 摘要 / 正文全文搜索

sqlite-vec 负责：

- 存储文章 embedding
- 存储兴趣画像向量
- 支持向量相似度检索

后续可选适配：

- MySQL / MariaDB
- Postgres + pgvector

但这些不作为第一阶段默认方案。

## sqlite-vec 集成策略

sqlite-vec 作为默认向量检索能力，但不作为唯一权威数据源。

集成方式：

```text
业务代码
  -> VectorStore 接口
    -> SqliteVecVectorStore 实现
      -> sqlite-vec vec0 虚拟表
```

业务代码不直接依赖 sqlite-vec 的 SQL 细节，例如 `vec0` 建表语法、KNN 查询语法或距离函数。所有 sqlite-vec 相关 SQL 都集中在 `SqliteVecVectorStore` adapter 内。

原因：

- sqlite-vec 仍处于 pre-v1 阶段，未来小版本也可能出现 breaking changes。
- Node.js binding 和 extension 加载方式存在版本与平台差异。
- 自托管环境可能包括 macOS、Linux、Alpine、ARM、NAS 等不同平台。
- 未来若更换向量存储，业务层不应大改。

设计原则：

- 锁定 sqlite-vec 版本，不自动跟随最新版。
- 所有 sqlite-vec SQL 只放在 adapter 内。
- 保留原始 embedding BLOB 作为权威数据。
- sqlite-vec 虚拟表视为可重建索引。
- 升级 sqlite-vec 前必须通过迁移脚本和重建索引验证。

建议数据关系：

```text
article_embeddings
- article_id
- embedding_index_id
- vector_blob
- created_at

sqlite_vec_article_index
- sqlite-vec vec0 虚拟表
- 可由 article_embeddings 重建
```

如果 sqlite-vec 索引损坏、版本升级或表结构变化，系统应能从 `article_embeddings.vector_blob` 重建向量索引，而不是重新调用 embedding provider。

## 第一阶段语言与框架

第一阶段主技术栈选择：

> TypeScript + Node.js + Fastify + React / Vite

选择依据：

- 前后端可以共用 TypeScript 类型，降低 API、数据模型和客户端状态的维护成本。
- 项目核心是 Web App、RSS 后台任务、配置体验和多端复用，TypeScript 生态更贴近第一阶段目标。
- RSS 解析、Readability 正文抽取、Web 前端、PWA、Capacitor 打包都有成熟生态。
- sqlite-vec 提供 Node.js 安装方式，可以作为默认向量存储路线的一部分。
- Node.js 服务端更利于把 Web App、API、后台 worker 打包进一个自托管服务。
- 相比 Python，TypeScript 可以减少前后端双语言带来的心智成本。
- 相比 Go / Rust，TypeScript 更适合快速打磨产品体验和 UI / API 协同。

后端建议：

```text
Node.js
Fastify
SQLite
sqlite-vec
后台 worker
```

前端建议：

```text
React
Vite
PWA
后续通过 Capacitor 打包移动端
```

暂不选择 Next.js 作为第一阶段主框架。原因是本项目更像一个登录后使用的应用工具，而不是需要 SSR / SEO 的内容站点；同时 RSS 抓取、embedding、排序等长期后台任务更适合独立 API + worker 架构。

如后续需要本地模型推理或更复杂的算法实验，可以增加 Python sidecar 或独立 embedding worker，但不把 Python 作为第一阶段主后端。

## 前端组件体系与视觉方向

第一阶段前端组件体系选择：

> React Aria Components + Dibao Design System

不采用 shadcn/ui 作为默认组件体系。原因是 shadcn/ui 默认气质偏美式 SaaS / 开发者工具，与邸报希望呈现的东方阅读器气质不完全匹配。

React Aria Components 负责：

- 可访问性
- 键盘交互
- 触摸交互
- 国际化基础
- 常见组件的行为逻辑

Dibao Design System 负责：

- 视觉风格
- 设计 tokens
- 颜色、字体、间距、圆角、边线
- 文章列表、阅读页、订阅源管理、设置页等产品组件

样式方案选择：

> CSS Modules + CSS Variables

选择依据：

- 接近原生 CSS，长期维护风险低。
- 适合做阅读器所需的细腻排版、留白、边线和文字层级。
- 不引入额外样式编译体系，部署和工具链更轻。
- CSS Variables 天然适合运行时主题和阅读设置。
- 用户后续可在界面中调节字号、行高、段间距、阅读宽度和背景色等阅读参数。

样式系统分为两层：

```text
System Tokens
控制整个 App 的基础视觉：
颜色、边线、圆角、阴影、基础间距。

Reader Tokens
控制阅读体验：
字号、字体、行高、段距、阅读宽度、首行缩进、背景色。
```

视觉关键词：

```text
东亚阅读器
报纸感
低饱和
细边线
高文字密度
温润纸白
墨色层级
少卡片
少渐变
少装饰
```

应避免的默认气质：

```text
美式 SaaS
大圆角卡片
紫蓝渐变
Bento Grid
Dashboard 风
```

## 向量与 embedding 设计共识

sqlite-vec 不负责生成 embedding，只负责存储和检索已经生成好的向量。

因此系统需要把 embedding 生成和向量存储分层：

```text
Embedding Provider
Ollama / 本地模型 / OpenAI-compatible API / 云端模型

Vector Store
sqlite-vec

Ranking Engine
兴趣簇匹配、时间衰减、来源权重、多样性控制
```

用户应可以配置 embedding provider，例如：

- Ollama
- OpenAI-compatible API
- 云端 embedding 服务
- 后续本地 ONNX / sentence-transformers 等方案

需要注意：

- 不同 embedding 模型的向量不能混用。
- 模型、维度、距离函数需要成为系统中的一等配置。
- 换模型后需要重建向量索引，或者维护多套 embedding index。

建议抽象：

```text
embedding_providers
- id
- type
- base_url
- model
- dimension
- api_key_encrypted
- enabled

embedding_indexes
- id
- provider_id
- model
- dimension
- distance_metric
- table_name
- status
- created_at
```

## Embedding Provider 默认策略

邸报支持多种 embedding provider，并通过统一 `EmbeddingProvider` 接口接入。

默认策略：

> 优先推荐外部 provider；内置小模型只作为零配置 fallback。

原因：

- 邸报的目标不是简单语义搜索，而是长期个性化排序。
- 小型 embedding 模型可以保证可用，但不一定能提供足够好的推荐第一印象。
- 用户 RSS 内容可能包含中文、英文、日文和不同专业领域，对模型质量有一定要求。
- 直接把内置小模型包装成“最佳默认体验”不够诚实。

Provider 分层：

```text
Basic
内置小模型
零配置、离线、免费，适合试用和低资源部署。

Recommended
Ollama / 外部本地模型服务
数据仍可留在本地或自有服务器，推荐质量通常更好，但需要额外部署。

Best Quality
OpenAI-compatible / 云端 embedding API
质量和速度更稳定，但需要 API key，且文本会发送到外部服务。
```

首次设置时应明确提示用户当前 provider 档位和预期效果。例如：

```text
你当前使用内置基础模型，适合试用。
若希望获得更好的个性化排序，建议配置 Ollama 或云端 embedding provider。
```

内置 fallback 模型候选：

- multilingual-e5-small

外部本地 provider 可推荐：

- bge-m3
- nomic-embed-text
- multilingual-e5-base / multilingual-e5-large

中文优化 provider 可推荐：

- bge-base-zh-v1.5
- bge-large-zh-v1.5

具体默认推荐模型可在实现阶段通过实际测试后确定。

## 推荐排序思路

不应该把推荐系统设计成“只有 embedding 相似度”。

最终排序应是混合分数：

```text
最终分 =
  兴趣匹配分
+ 来源权重
+ 新鲜度
+ 阅读状态
+ 用户显式规则
+ 多样性控制
- 重复内容惩罚
- 明确负反馈惩罚
```

初期推荐系统可以包括：

- 文章 embedding
- 用户正向兴趣簇
- 用户负向兴趣簇
- 来源偏好
- 关键词偏好
- 时间衰减
- 多样性控制

用户行为可以转化为偏好信号，例如：

- 只划过标题：弱负信号或低权重信号
- 点开：轻度正信号
- 阅读较长时间：中度正信号
- 读完：较强正信号
- 收藏 / 分享 / 加星：强正信号
- 不感兴趣 / 屏蔽：强负信号

但要避免把“未点击”直接解释成强烈不喜欢，因为用户可能只是暂时没空、标题不吸引、已知晓该信息，或当前上下文不合适。

## 用户画像兴趣簇算法

第一阶段采用：

> Profile Algorithm v0：规则驱动、可解释、可调。

用户画像不使用单一平均向量，而是维护多个兴趣簇。

兴趣簇类型：

- 正向兴趣簇
- 负向兴趣簇

每个兴趣簇包含：

```text
interest_clusters
- id
- polarity: positive / negative
- centroid_vector
- weight
- sample_count
- last_updated_at
- label 可选
```

更新原则：

- 高分行为更新正向兴趣簇。
- 明确负反馈更新负向兴趣簇。
- 普通划过、未点击等弱行为只作为低权重信号。
- 新行为文章先与已有兴趣簇计算相似度。
- 相似度超过阈值则合并到最相近的兴趣簇。
- 相似度低于阈值则创建新兴趣簇。
- 兴趣簇数量设置上限，避免画像过度碎片化。
- 长期未命中的兴趣簇按时间衰减。
- 过低权重或长期无效的兴趣簇可被清理。

推荐时，新文章与正向兴趣簇和负向兴趣簇分别计算相似度：

```text
兴趣匹配分 =
  最相关正向兴趣簇相似度 * 簇权重
- 最相关负向兴趣簇相似度 * 簇权重
```

具体阈值、权重和衰减公式可以在实现阶段通过真实使用数据调参，但算法形态已经确定为简单、透明、可解释的规则系统。

## 用户画像与文章删除

文章向量和用户画像需要分开。

文章 embedding：

- 与文章生命周期绑定。
- 可以随文章一起删除。
- 可以在换模型后重算。

用户画像向量：

- 是从用户行为中沉淀出来的长期特征。
- 不应因为旧文章删除而直接消失。
- 可以保留为兴趣簇、来源偏好、关键词偏好和行为统计。

建议数据生命周期：

```text
热数据：0～60 天文章
保存完整文章、全文索引、embedding、阅读状态，用于阅读和排序。

温数据：历史行为摘要
删除文章正文和文章 embedding，只保留行为统计、来源偏好、主题贡献。

长期画像：用户兴趣向量
保留正向兴趣簇、负向兴趣簇、来源权重、关键词权重。
```

当用户删除 60 天以上文章时：

- 删除文章正文、摘要缓存、全文索引和文章 embedding。
- 保留必要的历史行为摘要。
- 保留这些文章已经贡献到用户画像中的长期影响。

## 初步数据规模假设

以当前讨论中的个人使用规模为参考：

- 存量文章约 2 万篇。
- 每日新增未读约 300～400 篇。
- 文章保留约 60 天。

这个规模下，SQLite + sqlite-vec 是合理的默认方案。

推荐排序不必每次对全库做完整重算。更合理的是：

- RSS 抓取后对新增文章生成 embedding。
- 对新增 / 未读 / 未过期文章进行排序预计算。
- 将 ranking score 写回数据库。
- 前端读取预计算结果。

## 推荐解释 UI

MVP 提供轻量推荐解释 UI。

目标：

- 建立用户对排序系统的信任。
- 避免黑箱推荐感。
- 帮助用户理解和调教自己的偏好。
- 让用户知道文章为什么被排在前面或被扣分。

设计原则：

- 不展示复杂算法细节。
- 不展示过多原始分数。
- 每篇文章最多展示 3～5 条主要原因。
- 解释要使用普通用户能理解的语言。
- 解释入口保持克制，不干扰阅读列表。

交互形态：

- 桌面端：文章列表中提供轻量入口，点击后展示 Popover。
- 移动端：点击解释入口后展示 Bottom Sheet。

解释示例：

```text
推荐原因
- 匹配兴趣：AI 工具
- 来源权重较高：The Verge
- 新鲜度较高：2 小时前
- 轻微扣分：与 3 篇已读文章主题接近
```

推荐排序时应保存解释 payload，供前端直接展示：

```text
article_rank_explanations
- article_id
- matched_positive_cluster
- matched_negative_cluster
- source_score
- freshness_score
- diversity_penalty
- duplicate_penalty
- final_score
```

前端只展示主要原因，不直接暴露完整算法实现。

## 数据导入导出

邸报基于 RSS 生态，MVP 只承诺通用 RSS 迁移格式：

> OPML 导入 / 导出

OPML 用于：

- 导入订阅源
- 导入订阅源分组
- 导出订阅源
- 导出订阅源分组

用户行为数据和兴趣画像数据通常无法从其他 RSS 阅读器或平台导出，也缺少通用兼容格式，因此 MVP 不提供专门的行为数据导入 / 导出功能。

不作为 MVP 导出项：

- 阅读行为日志
- 兴趣画像
- embedding 向量
- 排序分
- 推荐中间状态

但这些数据必须保存在用户本地或用户自托管环境中。项目应提供清晰的数据格式文档，使第三方开发者可以理解数据库结构，并在需要时直接读取或兼容邸报数据。

设计原则：

- 迁移层面遵守 RSS 生态通用格式，即 OPML。
- 邸报内部数据不伪装成通用导出格式。
- 数据仍然属于用户，存储格式应被文档化。
- 第三方兼容通过公开数据库结构和数据格式文档实现。

## 仍待决策的问题

当前暂无。

## 当前阶段的设计原则

- 先做服务端优先，不把纯移动端本地计算作为第一目标。
- 默认部署要足够轻，优先 SQLite。
- 不引入独立 Vector DB。
- 推荐必须限制在用户订阅源内部。
- embedding 是增强排序能力，不是平台扩张入口。
- 用户画像要可解释、可删除、可重建。
- 数据所有权和可迁移性是核心价值。
