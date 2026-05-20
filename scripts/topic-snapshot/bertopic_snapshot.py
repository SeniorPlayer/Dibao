#!/usr/bin/env python3
import argparse
import html
import json
import re
import sqlite3
import sys
from importlib.metadata import version
from pathlib import Path

try:
    from janome.tokenizer import Tokenizer as JanomeTokenizer
    import jieba
    import numpy as np
    from bertopic import BERTopic
    from sklearn.feature_extraction.text import CountVectorizer
except Exception as exc:  # pragma: no cover - documented manual runner path
    print(f"Missing optional topic snapshot dependency: {exc}", file=sys.stderr)
    raise


DAY_MS = 24 * 60 * 60 * 1000
CONTENT_TEXT_LIMIT = 3000
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
HIRAGANA_RE = re.compile(r"[\u3040-\u309f]")
KATAKANA_RE = re.compile(r"[\u30a0-\u30ff]")
JAPANESE_RE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")
LATIN_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_+.#-]{1,}")
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
HTML_TAG_RE = re.compile(r"<[^>]+>")
HTML_ENTITY_RE = re.compile(r"&(?:[a-zA-Z]+|#\d+);")
TOKEN_EDGE_RE = re.compile(r"^[^\w\u4e00-\u9fff+.#-]+|[^\w\u4e00-\u9fff+.#-]+$")
ENTITY_RESIDUE_RE = re.compile(
    r"\b(?:ldquordquo|quot|ldquo|rdquo|lsquo|rsquo|nbsp|amp|mdash|hellip|middot|zwnj|zwj)+\b|"
    r"quot(?=[A-Z])|(?<=[A-Za-z])quot\b",
    re.IGNORECASE,
)
HTML_NOISE_PREFIXES = (
    "style",
    "class",
    "dataaction",
    "decodingasync",
    "font",
    "fontsize",
    "fontfamily",
    "margin",
    "padding",
    "align",
    "figcaption",
    "stytle",
)
HTML_NOISE_TOKENS = {
    "alt",
    "arial",
    "blockquote",
    "body",
    "br",
    "center",
    "comments",
    "div",
    "end",
    "figcaption",
    "figure",
    "footer",
    "head",
    "href",
    "html",
    "img",
    "li",
    "lili",
    "microsoft",
    "nbsp",
    "pcomments",
    "points",
    "ppoints",
    "script",
    "section",
    "span",
    "src",
    "style",
    "table",
    "tbody",
    "td",
    "th",
    "tr",
    "ul",
    "url",
    "yahei",
}
EN_STOPWORDS = {
    "about",
    "after",
    "again",
    "against",
    "all",
    "also",
    "and",
    "are",
    "because",
    "been",
    "being",
    "but",
    "can",
    "could",
    "for",
    "from",
    "has",
    "have",
    "her",
    "his",
    "how",
    "into",
    "its",
    "may",
    "more",
    "not",
    "now",
    "our",
    "out",
    "over",
    "she",
    "that",
    "the",
    "their",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "will",
    "with",
    "you",
    "your",
}
LETTER_DIGIT_RE = re.compile(r"[A-Za-z]\d+")
REPEATED_SHORT_LATIN_RE = re.compile(r"([A-Za-z]{1,3})\1{2,}")
TOKENIZER_MODES = {"mixed", "zh", "ja"}

CUSTOM_TERMS = [
    "邸报",
    "人工智能",
    "大模型",
    "本地模型",
    "开源模型",
    "向量数据库",
    "语义搜索",
    "推荐系统",
    "信息茧房",
    "科技向善",
    "RSS",
    "SQLite",
    "sqlite-vec",
    "BERTopic",
    "LLM",
    "AI Agent",
    "OpenAI",
    "Ollama",
    "API",
    "FTRL",
]

JA_CUSTOM_TERMS = [
    "人工知能",
    "生成AI",
    "大規模言語モデル",
    "機械学習",
    "深層学習",
    "推薦システム",
    "検索エンジン",
    "自然言語処理",
    "オープンソース",
    "ローカルモデル",
    "ベクトル検索",
    "意味検索",
]

STOPWORDS = {
    "一个",
    "一种",
    "这个",
    "那个",
    "这些",
    "那些",
    "我们",
    "你们",
    "他们",
    "自己",
    "今天",
    "昨天",
    "目前",
    "进行",
    "通过",
    "相关",
    "问题",
    "内容",
    "文章",
    "记者",
    "表示",
    "认为",
    "https",
    "http",
    "www",
    "com",
    "html",
    "utm",
    "href",
    "src",
    "责任编辑",
    "免责声明",
    "转载",
    "来源",
    "编辑",
    "图片",
    "正文",
    "点击",
    "阅读",
    "原文",
}

JA_STOPWORDS = {
    "これ",
    "それ",
    "あれ",
    "この",
    "その",
    "あの",
    "ここ",
    "そこ",
    "ため",
    "もの",
    "こと",
    "よう",
    "さん",
    "する",
    "ある",
    "いる",
    "なる",
    "できる",
    "ない",
    "れる",
    "られる",
    "について",
    "として",
    "など",
    "また",
    "そして",
    "ニュース",
    "記事",
    "発表",
    "今回",
    "現在",
}

_janome_tokenizer = None


def main() -> int:
    args = parse_args()
    try:
        configure_tokenizers(args.jieba_userdict)
    except Exception as exc:
        print(f"Failed to load jieba user dictionary: {exc}", file=sys.stderr)
        return 2

    rows = load_rows(
        db_path=args.db,
        embedding_index_id=args.embedding_index_id,
        max_articles=args.max_articles,
        scope_days=args.scope_days,
    )
    if len(rows) < max(args.min_topic_size, 2):
        write_json(
            args.output,
            {
                "algorithm": "bertopic_precomputed_embeddings",
                "algorithmVersion": algorithm_version(),
                "embeddingIndexId": args.embedding_index_id,
                "params": params(args),
                "articleCount": len(rows),
                "topics": [],
                "skipped": {
                    "missingEmbeddingCount": 0,
                    "staleEmbeddingCount": 0,
                },
            },
        )
        return 0

    article_ids = [row["article_id"] for row in rows]
    docs = [document_text(row) for row in rows]
    embeddings = np.vstack([row["vector"] for row in rows]).astype(np.float32)
    vectorizer = CountVectorizer(
        tokenizer=tokenizer_for(args.tokenizer),
        token_pattern=None,
        lowercase=False,
        ngram_range=(1, 2),
        min_df=1,
        max_df=0.6,
    )
    model = BERTopic(
        embedding_model=None,
        min_topic_size=args.min_topic_size,
        vectorizer_model=vectorizer,
        calculate_probabilities=True,
        verbose=False,
    )
    topics, probabilities = model.fit_transform(docs, embeddings)
    topic_payloads = []

    for topic_key in sorted(set(topics), key=lambda value: (value == -1, value)):
        indexes = [index for index, topic in enumerate(topics) if topic == topic_key]
        if not indexes:
            continue
        topic_id = str(topic_key)
        top_terms = [
            {"term": str(term), "weight": float(weight)}
            for term, weight in (model.get_topic(topic_key) or [])[:12]
            if term
        ]
        assignment_scores = assignment_scores_for(topic_key, topics, probabilities)
        representatives = representative_articles(rows, indexes, assignment_scores)
        topic_payloads.append(
            {
                "topicKey": topic_id,
                "label": label_for_topic(top_terms),
                "topTerms": top_terms,
                "representativeArticles": representatives,
                "assignments": [
                    {
                        "articleId": article_ids[index],
                        "assignmentScore": assignment_scores.get(index),
                        "isRepresentative": article_ids[index]
                        in {article["articleId"] for article in representatives},
                    }
                    for index in indexes
                ],
                "confidence": confidence_for(indexes, assignment_scores),
            }
        )

    write_json(
        args.output,
        {
            "algorithm": "bertopic_precomputed_embeddings",
            "algorithmVersion": algorithm_version(),
            "embeddingIndexId": args.embedding_index_id,
            "params": params(args),
            "articleCount": len(rows),
            "topics": topic_payloads,
            "skipped": {
                "missingEmbeddingCount": 0,
                "staleEmbeddingCount": 0,
            },
        },
    )
    return 0


def parse_args():
    parser = argparse.ArgumentParser(description="Build a Dibao corpus topic snapshot JSON file.")
    parser.add_argument("--db", required=True)
    parser.add_argument("--embedding-index-id", required=True)
    parser.add_argument("--max-articles", type=int, required=True)
    parser.add_argument("--scope-days", type=int, required=True)
    parser.add_argument("--min-topic-size", type=int, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--jieba-userdict")
    parser.add_argument("--tokenizer", choices=sorted(TOKENIZER_MODES), default="mixed")
    return parser.parse_args()


def configure_tokenizers(userdict: str | None) -> None:
    configure_jieba(userdict)


def configure_jieba(userdict: str | None) -> None:
    for term in CUSTOM_TERMS:
        jieba.add_word(term)
    if userdict:
        jieba.load_userdict(userdict)


def tokenizer_for(mode: str):
    if mode == "zh":
        return zh_tokenizer
    if mode == "ja":
        return ja_tokenizer
    return mixed_cjk_en_tokenizer


def zh_tokenizer(text: str) -> list[str]:
    cleaned = clean_tokenizer_text(text)
    return zh_tokens_from_cleaned_text(cleaned) + latin_tokens_from_cleaned_text(cleaned)


def ja_tokenizer(text: str) -> list[str]:
    cleaned = clean_tokenizer_text(text)
    return ja_tokens_from_cleaned_text(cleaned) + latin_tokens_from_cleaned_text(cleaned)


def mixed_cjk_en_tokenizer(text: str) -> list[str]:
    cleaned = clean_tokenizer_text(text)
    tokens = []
    if HIRAGANA_RE.search(cleaned) or KATAKANA_RE.search(cleaned):
        tokens.extend(ja_tokens_from_cleaned_text(cleaned))
    elif CJK_RE.search(cleaned):
        tokens.extend(zh_tokens_from_cleaned_text(cleaned))
    tokens.extend(latin_tokens_from_cleaned_text(cleaned))
    return tokens


def mixed_zh_en_tokenizer(text: str) -> list[str]:
    return zh_tokenizer(text)


def zh_tokens_from_cleaned_text(cleaned: str) -> list[str]:
    tokens = []
    tokens.extend(
        term
        for term in custom_terms_from_cleaned_text(CUSTOM_TERMS + JA_CUSTOM_TERMS, cleaned)
        if is_useful_zh_token(term)
    )
    for token in jieba.cut_for_search(cleaned, HMM=True):
        normalized = normalize_token(token)
        if is_useful_zh_token(normalized):
            tokens.append(normalized)
    return tokens


def ja_tokens_from_cleaned_text(cleaned: str) -> list[str]:
    tokens = []
    tokens.extend(
        term
        for term in custom_terms_from_cleaned_text(CUSTOM_TERMS + JA_CUSTOM_TERMS, cleaned)
        if is_useful_ja_token(term)
    )
    for token in janome_tokenizer().tokenize(cleaned):
        surface = token.surface.strip()
        base = token.base_form.strip() if token.base_form and token.base_form != "*" else surface
        part = token.part_of_speech.split(",")[0]
        if part not in {"名詞", "動詞", "形容詞", "未知語"}:
            continue
        normalized = normalize_token(base)
        if is_useful_ja_token(normalized):
            tokens.append(normalized)
    return tokens


def latin_tokens_from_cleaned_text(cleaned: str) -> list[str]:
    tokens = []
    for token in LATIN_TOKEN_RE.findall(cleaned):
        normalized = normalize_token(token)
        if is_useful_latin_token(normalized):
            tokens.append(normalized)
    return tokens


def custom_terms_from_cleaned_text(terms: list[str], cleaned: str) -> list[str]:
    tokens = []
    for term in terms:
        count = cleaned.count(term)
        if count > 0:
            tokens.extend([term] * count)
    return tokens


def janome_tokenizer():
    global _janome_tokenizer
    if _janome_tokenizer is None:
        _janome_tokenizer = JanomeTokenizer()
    return _janome_tokenizer


def clean_tokenizer_text(text: str) -> str:
    decoded = text
    for _ in range(2):
        next_decoded = html.unescape(decoded)
        if next_decoded == decoded:
            break
        decoded = next_decoded
    without_urls = URL_RE.sub(" ", decoded)
    without_markup = HTML_TAG_RE.sub(" ", without_urls)
    without_entities = HTML_ENTITY_RE.sub(" ", without_markup)
    return ENTITY_RESIDUE_RE.sub(" ", without_entities)


def normalize_token(token: str) -> str:
    return TOKEN_EDGE_RE.sub("", token.strip())


def is_useful_zh_token(token: str) -> bool:
    return is_useful_token(token, cjk_re=CJK_RE, stopwords=STOPWORDS | EN_STOPWORDS)


def is_useful_ja_token(token: str) -> bool:
    return is_useful_token(
        token,
        cjk_re=JAPANESE_RE,
        stopwords=STOPWORDS | JA_STOPWORDS | EN_STOPWORDS,
    )


def is_useful_latin_token(token: str) -> bool:
    return is_useful_token(
        token,
        cjk_re=JAPANESE_RE,
        stopwords=STOPWORDS | JA_STOPWORDS | EN_STOPWORDS,
    )


def is_useful_token(token: str, cjk_re, stopwords: set[str]) -> bool:
    if not token or len(token) > 32:
        return False
    lower = token.lower()
    if lower in HTML_NOISE_TOKENS:
        return False
    if lower.endswith(("gmailcom", "qqcom", "hotmailcom", "outlookcom")):
        return False
    if any(lower.startswith(prefix) for prefix in HTML_NOISE_PREFIXES):
        return False
    if REPEATED_SHORT_LATIN_RE.fullmatch(token):
        return False
    if LETTER_DIGIT_RE.fullmatch(token):
        return False
    if token.lower() in stopwords or token in stopwords:
        return False
    if cjk_re.search(token):
        return len(token) >= 2
    return LATIN_TOKEN_RE.fullmatch(token) is not None


def load_rows(db_path: str, embedding_index_id: str, max_articles: int, scope_days: int):
    cutoff = current_epoch_ms() - max(scope_days, 1) * DAY_MS
    query = """
      select
        a.id as article_id,
        a.title,
        a.summary,
        substr(coalesce(ac.content_text, ''), 1, ?) as content_text,
        f.title as feed_title,
        ae.vector_blob
      from articles a
      join feeds f on f.id = a.feed_id
      left join article_contents ac on ac.article_id = a.id
      join article_embeddings ae
        on ae.article_id = a.id
       and ae.embedding_index_id = ?
       and ae.content_hash = coalesce(a.content_hash, a.id || ':' || a.updated_at)
      where f.enabled = 1
        and f.deleted_at is null
        and a.deleted_at is null
        and a.status != 'deleted'
        and coalesce(a.published_at, a.discovered_at) >= ?
        and (
          trim(coalesce(a.title, '')) != ''
          or trim(coalesce(a.summary, '')) != ''
          or trim(substr(coalesce(ac.content_text, ''), 1, 256)) != ''
        )
      order by coalesce(a.published_at, a.discovered_at) desc, a.id
      limit ?
    """
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = []
        for row in connection.execute(
            query,
            (CONTENT_TEXT_LIMIT, embedding_index_id, cutoff, max(max_articles, 1)),
        ):
            vector = np.frombuffer(row["vector_blob"], dtype=np.float32)
            if vector.size == 0:
                continue
            rows.append(
                {
                    "article_id": row["article_id"],
                    "title": row["title"] or "",
                    "summary": row["summary"] or "",
                    "content_text": row["content_text"] or "",
                    "feed_title": row["feed_title"] or "",
                    "vector": vector,
                }
            )
        return rows
    finally:
        connection.close()


def document_text(row) -> str:
    title = row["title"].strip()
    summary = row["summary"].strip()
    parts = []
    if title:
        parts.extend([title, title])
    if summary:
        parts.append(summary)
    if len(" ".join(parts)) < 80 and row["content_text"]:
        parts.append(row["content_text"][:800])
    return "\n\n".join(parts)


def assignment_scores_for(topic_key: int, topics, probabilities):
    scores = {}
    if probabilities is None:
        return scores
    probabilities_array = np.asarray(probabilities)
    if probabilities_array.ndim == 1:
        for index, topic in enumerate(topics):
            if topic == topic_key:
                scores[index] = float(probabilities_array[index])
        return scores
    positive_topics = sorted(topic for topic in set(topics) if topic != -1)
    if topic_key not in positive_topics:
        return scores
    column = positive_topics.index(topic_key)
    if column >= probabilities_array.shape[1]:
        return scores
    for index, topic in enumerate(topics):
        if topic == topic_key:
            scores[index] = float(probabilities_array[index, column])
    return scores


def representative_articles(rows, indexes, assignment_scores):
    ranked = sorted(
        indexes,
        key=lambda index: assignment_scores.get(index, 0.0),
        reverse=True,
    )[:8]
    return [
        {
            "articleId": rows[index]["article_id"],
            "title": rows[index]["title"],
            "feedTitle": rows[index]["feed_title"],
            "score": assignment_scores.get(index),
        }
        for index in ranked
    ]


def confidence_for(indexes, assignment_scores) -> float:
    scores = [assignment_scores[index] for index in indexes if index in assignment_scores]
    if not scores:
        return 0.5
    return float(max(0.0, min(1.0, sum(scores) / len(scores))))


def label_for_topic(top_terms) -> str | None:
    terms = [term["term"] for term in top_terms[:3] if term.get("term")]
    return " / ".join(terms) if terms else None


def algorithm_version() -> str:
    try:
        return f"bertopic:{version('bertopic')}"
    except Exception:
        return "bertopic:unknown"


def params(args):
    return {
        "maxArticles": args.max_articles,
        "scopeDays": args.scope_days,
        "minTopicSize": args.min_topic_size,
        "tokenizer": args.tokenizer,
        "jiebaUserdict": bool(args.jieba_userdict),
    }


def write_json(path: str, payload) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def current_epoch_ms() -> int:
    return int(__import__("time").time() * 1000)


if __name__ == "__main__":
    raise SystemExit(main())
