create index if not exists idx_article_rank_scores_context_recommended_order
  on article_rank_scores(
    rank_context,
    score desc,
    (case when rerank_position is null then 1 else 0 end),
    rerank_position asc,
    article_id desc
  );
