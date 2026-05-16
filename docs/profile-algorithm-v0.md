# 邸报 Dibao Profile Algorithm v0 参数表

## 文档目的

本文定义邸报 MVP 的用户画像与推荐排序参数初稿。

Profile Algorithm v0 的目标不是追求机器学习最优，而是提供一套简单、透明、可解释、可调的规则系统，使邸报能从用户行为中逐步形成兴趣簇，并对订阅源内部的新文章进行个性化排序。

## 总体原则

- 推荐只发生在用户订阅源内部。
- embedding 是兴趣匹配信号，不是唯一排序依据。
- 用户画像由多个兴趣簇组成，不使用单一平均向量。
- 正向兴趣和负向兴趣分开维护。
- 弱行为不能被解释成强负反馈。
- 所有排序结果都应能生成轻量解释。
- 参数先保守，避免用户偶然行为造成剧烈偏移。

## 数据输入

### Article Features

```text
article_id
feed_id
published_at
discovered_at
title
summary
content_text_slice
article_embedding
read_state
```

### User Signals

```text
behavior_events
article_states
interest_clusters
feed_stats
ranking_settings
```

### Candidate Scope

推荐候选文章默认范围：

```text
enabled feed
not deleted
not hidden
not not_interested
within retention window
unread preferred
```

说明：

- Retention cleanup 会 soft delete 过期普通文章，并清理正文、FTS、rank 和 vector 派生数据。
- `behavior_events`、`article_states`、`feed_stats` 和 `interest_clusters` 保留，用于长期画像和来源统计。
- 过期文章被清理后不再作为推荐候选；后续 RSS refresh 不应恢复该 article 的正文、rank 或 vector。

## 行为权重

行为权重用于更新用户画像和来源统计。

```text
impression: 0.0
open: 0.0
read_progress_25: 1.2
read_progress_50: 2.0
read_progress_75: 3.0
read_complete: 4.0
favorite: 6.0
read_later: 3.0
mark_read: 1.0
quick_bounce: 0.0
hide: -3.5
not_interested: -6.0
unfavorite: -1.5
remove_read_later: -1.0
mark_unread: -0.5
```

说明：

- `impression` 表示列表中滚过但未点进，是 stats-only 信号，不单独创建负向兴趣簇；它会通过短期排序投影和文章状态产生轻度扣分。
- `open` 表示点进文章，是极弱 stats-only 正信号，不创建兴趣簇，不成为强来源偏好。
- `open` 与 `impression` 在文章交互状态上互斥：被忽略文章再次点进后状态回到 `opened`，后续通过 `read_progress` 判断真实阅读深度。
- `quick_bounce` 指打开后很快关闭且阅读进度很低。
- `not_interested` 是强负反馈。
- `favorite` 是最强正反馈。

## 画像更新资格

不是所有行为都会直接更新兴趣簇。

```text
update_positive_clusters:
  read_progress_50
  read_progress_75
  read_complete
  favorite
  read_later

update_negative_clusters:
  hide
  not_interested

stats_only:
  impression
  open
  read_progress_25
  quick_bounce
  mark_read
  mark_unread
  unfavorite
  remove_read_later
```

说明：

- `quick_bounce` 会影响来源统计和短期排序，但不会单独创建负向兴趣簇。
- 如果某一主题连续多次出现 quick bounce，可在后续版本中升级为弱负向主题信号；MVP 先不做。
- 用户显式动作优先于自动推断行为。

## 行为派生规则

### Read Progress

```text
progress >= 0.25 -> read_progress_25
progress >= 0.50 -> read_progress_50
progress >= 0.75 -> read_progress_75
progress >= 0.90 -> read_complete
progress >= 0.75 且 activeDurationMs >= min(90s, estimated_read_time * 0.5) -> read_complete
```

同一文章的 progress 事件按最高档计入画像，不重复叠加所有档位。

### Long Read

```text
activeDurationMs >= min(90s, estimated_read_time * 0.5)
```

可派生为 `read_complete`。后端从 `read_progress.metadata.activeDurationMs` 消费该字段；前端未采集时不影响普通 progress 档位。

`estimated_read_time` 由后端按 `title + summary + content_text` 估算：

```text
estimated_read_time = clamp(reading_units / 500 per minute, 30s, 15min)
```

### Quick Bounce

```text
duration <= 8s
reading_progress <= 0.10
```

只作为弱负反馈。MVP 中 quick bounce 只进入 `stats_only`，不创建新的负向兴趣簇。

## 兴趣簇结构

每个兴趣簇：

```text
id
embedding_index_id
polarity: positive | negative
label
centroid_vector
weight
sample_count
last_matched_at
created_at
updated_at
```

默认限制：

```text
max_positive_clusters: 24
max_negative_clusters: 16
min_cluster_weight: 0.8
max_cluster_weight: 100
```

## 兴趣簇创建与合并

### 相似度阈值

使用 cosine similarity。

```text
positive_merge_threshold: 0.72
positive_create_threshold: 0.48
negative_merge_threshold: 0.76
negative_create_threshold: 0.55
```

解释：

- 正向兴趣可以更宽一些，方便学习新主题。
- 负向兴趣更谨慎，避免误伤。
- 低于 create threshold 的行为不创建新簇，只记录行为统计。

### 更新流程

```text
1. 行为事件产生行为权重。
2. 获取文章 embedding。
3. 根据画像更新资格判断是否允许更新兴趣簇。
4. 根据事件类型选择 positive / negative 簇。
5. 找到最相似的同极性兴趣簇。
6. similarity >= merge_threshold -> 更新该簇。
7. similarity < merge_threshold 且 similarity >= create_threshold -> 创建新簇。
8. similarity < create_threshold -> 只记录来源统计，不更新兴趣簇。
```

### Centroid 更新公式

```text
learning_rate = clamp(abs(event_weight) / 20, 0.03, 0.18)
new_centroid = normalize(old_centroid * (1 - learning_rate) + article_vector * learning_rate)
```

权重更新：

```text
new_weight = clamp(old_weight + abs(event_weight), min_cluster_weight, max_cluster_weight)
sample_count += 1
last_matched_at = now
```

### 新簇初始值

```text
centroid_vector = article_vector
weight = clamp(abs(event_weight), min_cluster_weight, 8)
sample_count = 1
last_matched_at = now
```

## 兴趣簇清理与衰减

### 时间衰减

每日任务执行一次。

```text
daily_decay_rate: 0.985
inactive_decay_rate: 0.96
negative_daily_decay_rate: 0.99
negative_inactive_decay_rate: 0.98
inactive_after_days: 21
```

公式：

```text
elapsed_days = floor((now - app_settings.profile.decayLastRunAt) / 1d)

if elapsed_days <= 0:
  skip decay
else if polarity == negative and days_since_last_matched <= inactive_after_days:
  weight *= negative_daily_decay_rate ^ elapsed_days
else if polarity == negative:
  weight *= negative_inactive_decay_rate ^ elapsed_days
else if days_since_last_matched <= inactive_after_days:
  weight *= daily_decay_rate ^ elapsed_days
else:
  weight *= inactive_decay_rate ^ elapsed_days
```

说明：同一天重复运行 `profile_decay` 不再次指数衰减；跨天衰减按距离上次 decay 的 elapsed days 计算。负向簇更保守，避免用户明确不喜欢的主题过快消失。

### 清理规则

```text
delete_if_weight_below: 0.5
delete_if_sample_count_is_1_and_inactive_days_over: 30
negative_delete_if_weight_below: 0.5
negative_delete_if_sample_count_is_1_and_inactive_days_over: 60
```

### 数量上限处理

当簇数量超过上限：

```text
1. 先合并同极性中 similarity >= 0.86 的簇。
2. 若仍超限，删除低权重且长期未命中的簇。
3. 若仍超限，删除权重最低的簇。
```

## 来源统计参数

来源统计用于 `source_score`。

```text
feed_positive_event_weight:
  open: 0.02
  read_complete: 1.0
  favorite: 2.0
  read_later: 1.0

feed_negative_event_weight:
  impression: 0.05
  quick_bounce: 0.2
  hide: 1.5
  not_interested: 2.5
```

来源分计算：

```text
clear_signal_count = count(read_complete, favorite, read_later, quick_bounce, hide, not_interested)
confidence = clamp(clear_signal_count / 10, 0, 1)
open_only_confidence = 0.1
raw_feed_score = positive_score - negative_score
source_score = tanh(raw_feed_score / 20) * source_score_max * confidence
source_score_max = 0.18
```

说明：

- 来源权重有上限，不能压倒兴趣匹配。
- 用户手动设置的 `source_weight` 可作为额外加权。
- `open` 和 `impression` 不计入 clear signals；只有 open 时使用极低 open-only confidence，避免来源偏好完全归零但也不能过拟合。
- 10+ 个明确信号后，来源偏好才明显生效。

## 推荐排序参数

最终分：

```text
final_score =
  interest_score
+ source_score
+ freshness_score
+ state_score
+ diversity_score
- duplicate_penalty
- negative_interest_penalty
```

默认权重上限：

```text
interest_score_max: 0.55
source_score_max: 0.18
freshness_score_max: 0.18
state_score_max: 0.08
diversity_score_max: 0.08
duplicate_penalty_max: 0.20
negative_interest_penalty_max: 0.45
```

最终分建议 clamp：

```text
final_score: 0.0 - 1.0
```

## Interest Score

### 正向兴趣分

```text
positive_match = max(cosine(article_vector, positive_cluster.centroid) * cluster_weight_norm)
positive_score = positive_match * interest_score_max
```

`cluster_weight_norm`：

```text
cluster_weight_norm = clamp(log1p(cluster.weight) / log1p(max_cluster_weight), 0, 1)
```

### 负向兴趣惩罚

```text
negative_match = max(cosine(article_vector, negative_cluster.centroid) * cluster_weight_norm)
negative_interest_penalty = negative_match * negative_interest_penalty_max
```

只有当 similarity >= 0.62 时才启用负向惩罚。

```text
negative_penalty_threshold: 0.62
```

## Freshness Score

新闻阅读需要新鲜度，但不能只按时间排序。

```text
age_hours = now - published_at
freshness_score = exp(-age_hours / freshness_half_life_hours) * freshness_score_max
freshness_half_life_hours: 36
```

如果 `published_at` 缺失，使用 `discovered_at`。

## State Score

```text
unread: +0.06
read_later: +0.08
favorite: +0.04
read: -0.08
```

说明：

- 推荐首页默认以未读为主。
- 收藏文章不应因已读完全消失，但推荐首页也不应被收藏旧文占据。

## Diversity Score

为了避免首页被同一来源或同一主题占满，排序后做轻量 rerank。

参数：

```text
max_same_feed_in_top_20: 5
max_same_cluster_in_top_20: 6
diversity_boost_for_underrepresented_feed: 0.03
diversity_penalty_same_feed_over_limit: 0.05
diversity_penalty_same_cluster_over_limit: 0.06
```

说明：

- Diversity 是二次排序调整，不直接改变用户画像。
- MVP 可先实现来源多样性，再实现主题簇多样性。

## Duplicate Penalty

重复惩罚用于压低主题高度相似的文章。

参数：

```text
duplicate_similarity_threshold: 0.88
duplicate_penalty_per_seen_similar: 0.05
duplicate_penalty_max: 0.20
```

规则：

- 如果新文章与已读文章高度相似，扣分。
- 如果新文章与未读文章高度相似，只保留分数更高的一篇在前面。
- 不自动删除重复文章。

## Cold Start 策略

### 无 embedding provider

使用基础排序：

```text
final_score =
  freshness_score
+ source_score
+ state_score
+ behavior_event_score
- state_penalty
```

解释中显示：

```text
当前使用基础排序，embedding 尚未配置。
```

当前 MVP 的 `rank_context=base` 实现不读取 embedding，直接写入 `article_rank_scores`：

```text
freshness_score_max: 0.35
source_weight_max_score: 0.18
feed_stat_max_score: 0.10
favorite: +0.50
read_later: +0.24
reading_progress: progress * 0.22
read: -0.06
behavior_projection_score: event_type projection, clamp -0.12..0.16
hidden: -3.00
not_interested: -4.00
```

Base ranking 不直接信任历史 `behavior_events.event_weight`。当前投影：

```text
impression: -0.025
open: +0.005
read_progress_25: +0.01
read_progress_50: +0.04
read_progress_75: +0.06
read_complete: +0.10
favorite: +0.12
read_later: +0.08
quick_bounce: -0.04
other: 0
```

`latest` 仍按发布时间/发现时间排序；`recommended` 使用 `article_rank_scores(base)` 排序，并继续排除 hidden 与 not_interested 文章。

### 有 provider 但文章未 embedding

使用基础排序风格的 pending score，并排入 embedding job。

pending score 使用 freshness/source/state/base projection，不做语义正负匹配。若文章 age <= 72h，freshness 至少保留 `0.035` 的 floor，避免 provider 慢时新文章完全被旧文章淹没。

解释中显示：

```text
当前使用基础排序，embedding 尚未完成。
```

### 无用户画像

使用：

```text
freshness_score
source_score
state_score
```

并在解释中显示：

```text
邸报还在学习你的偏好。
```

## Ranking Job

触发时机：

```text
new_articles_imported
article_embedding_created
behavior_event_recorded
profile_clusters_updated
feed_stats_updated
daily_decay_completed
```

实现说明：

- `behavior_events.event_weight` 是行为 API 的基础权重，不作为画像权重的唯一来源；Profile Service 按本文档的事件类型和 read progress 档位重新映射画像权重。
- Profile 事件处理必须按 `eventId` 幂等。当前实现将 processed 标记写入 `article_behavior_summaries.topic_snapshot_json`，并按 `embeddingIndexId + contentHash` 分组。
- 如果文章 `contentHash` 变化，MVP 不把旧事件重放到新向量；等待后续 full profile rebuild。
- article action 请求路径只同步处理本次事件和 profile，不同步全量 ranking；推荐重算通过 `ranking_recalculate` job 完成。

候选范围：

```text
retention window
enabled feeds
not hidden
not not_interested
active articles
```

推荐首页默认取：

```text
top 200 candidates precomputed
API page size 50
```

## Explain Payload 规则

每篇文章最多保存 5 条主要原因。

优先级：

```text
1. strongest positive cluster match
2. strongest negative cluster penalty
3. source score
4. freshness score
5. duplicate penalty
6. fallback / learning state
```

示例：

```json
{
  "reasons": [
    { "type": "positive_cluster", "label": "AI 工具", "impact": "positive" },
    { "type": "source", "label": "少数派", "impact": "positive" },
    { "type": "freshness", "label": "2 小时前", "impact": "positive" },
    { "type": "duplicate", "label": "与 2 篇已读文章主题接近", "impact": "negative" }
  ]
}
```

MVP 当前实时生成解释，不写入 `article_rank_explanations`。`interest` reason 表示正向兴趣簇匹配；无 provider、embedding pending 或画像不足时返回 `fallback`。

## Ranking Settings 映射

设置页可提供三个用户可调滑块。MVP 可以先隐藏，后续再开放。

```text
preferFreshness: 0.0 - 1.0, default 0.5
preferSource: 0.0 - 1.0, default 0.5
preferDiversity: 0.0 - 1.0, default 0.5
```

映射方式：

```text
freshness_score_max = lerp(0.10, 0.26, preferFreshness)
source_score_max = lerp(0.10, 0.24, preferSource)
diversity_score_max = lerp(0.02, 0.12, preferDiversity)
```

说明：

- 兴趣匹配仍是推荐主信号。
- 用户滑块只调整排序倾向，不直接改画像。

## 实现验收标准

Profile Algorithm v0 完成后，应满足：

- 收藏文章能创建或增强正向兴趣簇。
- 不感兴趣能创建或增强负向兴趣簇。
- 未点击曝光不会直接创建负向兴趣簇。
- 同主题高分文章会合并到已有簇，而不是无限创建新簇。
- 兴趣簇超过上限时能清理或合并。
- 新文章能生成 `article_rank_scores`。
- 新文章能生成 `article_rank_explanations`。
- 无 provider、无 embedding、无画像时都有 fallback 排序。
- 排序解释不暴露复杂分数，只展示主要原因。

## 待真实使用校准的参数

以下参数需要在真实 RSS 数据和使用行为中校准：

- merge thresholds
- behavior weights
- freshness half-life
- source score cap
- duplicate similarity threshold
- diversity rerank limits
- quick bounce 判定阈值

调整原则：

- 先保守，后敏感。
- 优先减少误伤。
- 优先保护阅读体验稳定。
- 每次调整应记录在 changelog 或参数迁移说明中。
