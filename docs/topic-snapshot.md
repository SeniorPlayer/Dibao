# Corpus Topic Snapshot

Corpus Topic Snapshot 是邸报的语料主题快照层。它只用于 explainability / diagnostics metadata：

- 推荐透明页展示订阅语料的主题地图；
- 兴趣簇自动标签的辅助 terms；
- 兴趣簇质量诊断；
- 后续调试和可解释性分析。

它不参与排序，不改变 profile，不改变 `interest_clusters`，不更新 centroid / weight / sample_count，不影响 latest / recommended 排序，也不触发 FTRL、ranking recalculation、vector index rebuild、FTS rebuild 或 embedding backfill。

## 数据来源

Topic Snapshot 只复用已有 `article_embeddings`：

- 必须存在 active embedding index；
- 只读取该 index 下的 `article_embeddings.vector_blob`；
- `article_embeddings.content_hash` 必须匹配当前文章 hash；
- feed 必须 enabled 且未删除；
- article 必须未删除，且 `status != 'deleted'`；
- title / summary / content_text 至少一个非空；
- 默认最近 60 天，最多 3000 篇。

没有向量、向量过期、provider 未配置、active index 不存在时，snapshot rebuild 会跳过或返回明确状态。它绝不会调用 embedding provider，也不会创建 `embedding_generate` job。

## 数据表

Migration `010_corpus_topic_snapshots` 新增：

- `corpus_topic_runs`: 一次快照运行的状态、参数、计数和错误；
- `corpus_topics`: 每个主题的 top terms、代表文章、派生 centroid；
- `corpus_topic_articles`: 每篇参与快照文章到主题的 assignment。

`corpus_topics.centroid_vector_blob` 是由主题内已有文章向量平均并归一化得到的派生数据，不是新 embedding。

## Runner

BERTopic 是可选 Python runner，不是主 server runtime 依赖。未安装 Python / BERTopic，或未配置 `DIBAO_TOPIC_SNAPSHOT_COMMAND` 时，主服务仍正常启动。

Runner 默认使用 `mixed` tokenizer 支持中、日、英三语 topic terms：中文文本使用 jieba，日文文本使用 Janome，英文/技术词使用 regex 保留。jieba / Janome 只影响 BERTopic c-TF-IDF / topic terms，不参与 embedding，不生成向量，不调用 embedding provider，也不下载模型。BERTopic 仍然通过 `embedding_model=None` 和 `model.fit_transform(docs, embeddings)` 消费已有 `article_embeddings.vector_blob`。

手动安装与运行见：

```text
scripts/topic-snapshot/README.md
```

服务端通过环境变量配置 runner：

```bash
DIBAO_TOPIC_SNAPSHOT_COMMAND="python scripts/topic-snapshot/bertopic_snapshot.py"
DIBAO_TOPIC_SNAPSHOT_TOKENIZER=mixed
```

`DIBAO_TOPIC_SNAPSHOT_TOKENIZER` 可选值：

- `mixed`: 默认值。出现平假名/片假名时优先 Janome，否则汉字文本使用 jieba；英文/技术词始终用 regex 保留。
- `zh`: 中文优先，使用 jieba + 英文/技术词 regex。
- `ja`: 日文优先，使用 Janome + 英文/技术词 regex。

可选传入用户词典：

```bash
python scripts/topic-snapshot/bertopic_snapshot.py \
  --db /data/dibao.sqlite \
  --embedding-index-id <active-index-id> \
  --max-articles 3000 \
  --scope-days 60 \
  --min-topic-size 15 \
  --tokenizer zh \
  --jieba-userdict /path/to/userdict.txt \
  --output /tmp/dibao-topic-snapshot.json
```

日文优先手动运行示例：

```bash
python scripts/topic-snapshot/bertopic_snapshot.py \
  --db /data/dibao.sqlite \
  --embedding-index-id <active-index-id> \
  --max-articles 3000 \
  --scope-days 60 \
  --min-topic-size 15 \
  --tokenizer ja \
  --output /tmp/dibao-topic-snapshot.json
```

用户词典格式示例：

```text
邸报 100 nz
科技向善 100 n
大模型 100 n
本地模型 100 n
语义搜索 100 n
向量数据库 100 n
信息茧房 100 n
RSS 100 nz
sqlite-vec 100 nz
BERTopic 100 nz
```

API 只会 enqueue 后台 job，不会在请求路径同步跑 BERTopic。

## NAS 建议

Topic Snapshot 是低频后台任务。NAS 上建议每日或每周手动/定时运行，默认最多处理 3000 篇文章。它不会补齐缺失 embeddings；如需 embedding coverage，应使用明确的 embedding backfill 操作。

## 标签增强

`interest_cluster_label_rebuild` 会读取 active index 最新成功的 topic snapshot，将相关 topic 的 top terms 作为 `corpus_topic` 候选来源：

- 优先使用 cluster evidence articles 对应的 topic；
- 辅助使用 cluster centroid 与 topic centroid 的 cosine similarity；
- 默认最多取 3 个 topic、12 个 topic terms；
- 权重低于直接 evidence title，高于 feed title fallback；
- 只影响 `auto_label`、`label_terms_json` 和 `confidence`；
- `manual_label` 永远优先，清除后恢复自动标签。
