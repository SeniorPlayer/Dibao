import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpDir = resolve(repoRoot, ".tmp");
const dbPath = resolve(tmpDir, "sqlite-vec-spike.sqlite");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function vectorBlob(values) {
  return Buffer.from(new Float32Array(values).buffer);
}

function vectorJson(values) {
  return JSON.stringify(values);
}

function resetDatabase() {
  mkdirSync(tmpDir, { recursive: true });
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
}

function setupDatabase(db) {
  sqliteVec.load(db);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    create table articles (
      id text primary key,
      title text not null,
      summary text,
      content_text text
    );

    create virtual table article_fts using fts5(
      article_id unindexed,
      title,
      summary,
      content_text
    );

    create table embedding_indexes (
      id text primary key,
      model text not null,
      dimension integer not null,
      distance_metric text not null,
      table_name text not null unique
    );

    create table article_embeddings (
      article_id text not null references articles(id) on delete cascade,
      embedding_index_id text not null references embedding_indexes(id) on delete cascade,
      vector_blob blob not null,
      content_hash text not null,
      created_at integer not null,
      updated_at integer not null,
      primary key (article_id, embedding_index_id)
    );

    create table article_vector_rows (
      article_id text not null references articles(id) on delete cascade,
      embedding_index_id text not null references embedding_indexes(id) on delete cascade,
      vec_rowid integer not null,
      created_at integer not null,
      primary key (article_id, embedding_index_id),
      unique (embedding_index_id, vec_rowid)
    );

    create virtual table vec_articles_spike using vec0(
      embedding float[4]
    );
  `);
}

function seedArticles(db) {
  const now = Date.now();
  const articles = [
    {
      id: "article_ai_local",
      title: "Local embedding for personal RSS ranking",
      summary: "Using local vectors for a private recommender.",
      contentText: "RSS personalization with local embeddings and transparent ranking.",
      vector: [0.96, 0.12, 0.05, 0.02]
    },
    {
      id: "article_ai_agents",
      title: "Agent tooling and vector search",
      summary: "A practical look at agents and retrieval.",
      contentText: "Vector search and agent workflows for local-first tools.",
      vector: [0.88, 0.20, 0.08, 0.05]
    },
    {
      id: "article_design",
      title: "Japanese editorial layout systems",
      summary: "Typography and quiet interface density.",
      contentText: "Editorial design, spacing, type and reading rhythm.",
      vector: [0.05, 0.08, 0.92, 0.20]
    },
    {
      id: "article_finance",
      title: "Macro markets weekly note",
      summary: "Rates, inflation and equity flows.",
      contentText: "Financial markets and macroeconomic conditions.",
      vector: [0.03, 0.04, 0.18, 0.95]
    }
  ];

  db.prepare(`
    insert into embedding_indexes (id, model, dimension, distance_metric, table_name)
    values ('index_spike', 'deterministic-fixture-4d', 4, 'cosine', 'vec_articles_spike')
  `).run();

  const insertArticle = db.prepare(`
    insert into articles (id, title, summary, content_text)
    values (@id, @title, @summary, @contentText)
  `);
  const insertFts = db.prepare(`
    insert into article_fts (article_id, title, summary, content_text)
    values (@id, @title, @summary, @contentText)
  `);
  const insertEmbedding = db.prepare(`
    insert into article_embeddings (
      article_id,
      embedding_index_id,
      vector_blob,
      content_hash,
      created_at,
      updated_at
    )
    values (?, 'index_spike', ?, ?, ?, ?)
  `);
  const insertVec = db.prepare(`
    insert into vec_articles_spike (embedding)
    values (?)
  `);
  const insertRow = db.prepare(`
    insert into article_vector_rows (article_id, embedding_index_id, vec_rowid, created_at)
    values (?, 'index_spike', ?, ?)
  `);

  const tx = db.transaction(() => {
    articles.forEach((article, index) => {
      insertArticle.run(article);
      insertFts.run(article);
      insertEmbedding.run(
        article.id,
        vectorBlob(article.vector),
        `hash_${article.id}`,
        now,
        now
      );
      const vecRowid = Number(insertVec.run(vectorBlob(article.vector)).lastInsertRowid);
      insertRow.run(article.id, vecRowid, now);
    });
  });

  tx();
}

function searchSimilar(db, queryVector, limit = 3) {
  return db.prepare(`
    select
      avr.article_id as articleId,
      a.title,
      v.distance
    from vec_articles_spike v
    join article_vector_rows avr
      on avr.vec_rowid = v.rowid
     and avr.embedding_index_id = 'index_spike'
    join articles a
      on a.id = avr.article_id
    where v.embedding match ?
      and k = ?
    order by v.distance
  `).all(vectorJson(queryVector), limit);
}

function searchFts(db, query) {
  return db.prepare(`
    select article_id as articleId, title
    from article_fts
    where article_fts match ?
    order by rank
    limit 5
  `).all(query);
}

function rebuildVectorIndex(db) {
  db.exec(`
    delete from vec_articles_spike;
    delete from article_vector_rows;
  `);

  const embeddings = db.prepare(`
    select article_id, vector_blob
    from article_embeddings
    where embedding_index_id = 'index_spike'
    order by article_id
  `).all();

  const insertVec = db.prepare(`
    insert into vec_articles_spike (embedding)
    values (?)
  `);
  const insertRow = db.prepare(`
    insert into article_vector_rows (article_id, embedding_index_id, vec_rowid, created_at)
    values (?, 'index_spike', ?, ?)
  `);

  const now = Date.now();
  const tx = db.transaction(() => {
    embeddings.forEach((embedding) => {
      const vecRowid = Number(insertVec.run(embedding.vector_blob).lastInsertRowid);
      insertRow.run(embedding.article_id, vecRowid, now);
    });
  });

  tx();
}

function main() {
  resetDatabase();
  const db = new Database(dbPath);

  try {
    setupDatabase(db);

    const version = db.prepare("select vec_version() as version").get().version;
    assert(version, "sqlite-vec version should be available");

    seedArticles(db);

    const ftsResults = searchFts(db, "embedding");
    assert(ftsResults.length >= 1, "FTS5 should return an embedding article");

    const vectorResults = searchSimilar(db, [0.94, 0.14, 0.04, 0.03]);
    assert(vectorResults.length === 3, "KNN should return three nearest neighbors");
    assert(
      vectorResults[0].articleId === "article_ai_local",
      `Expected article_ai_local first, got ${vectorResults[0].articleId}`
    );

    db.exec("delete from vec_articles_spike; delete from article_vector_rows;");
    const emptyResults = searchSimilar(db, [0.94, 0.14, 0.04, 0.03]);
    assert(emptyResults.length === 0, "Vector index should be empty after deletion");

    rebuildVectorIndex(db);
    const rebuiltResults = searchSimilar(db, [0.94, 0.14, 0.04, 0.03]);
    assert(
      rebuiltResults[0].articleId === "article_ai_local",
      "Rebuilt vector index should preserve nearest neighbor result"
    );

    const summary = {
      sqliteVecVersion: version,
      databasePath: dbPath,
      ftsTopHit: ftsResults[0],
      vectorTopHit: vectorResults[0],
      rebuiltTopHit: rebuiltResults[0],
      checks: [
        "sqlite-vec load()",
        "vec_version()",
        "SQLite WAL pragmas",
        "FTS5 query",
        "article_embeddings BLOB authority table",
        "sqlite-vec vec0 KNN query",
        "article_vector_rows rowid mapping",
        "rebuild vec0 index from BLOB"
      ]
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.close();
  }
}

main();
