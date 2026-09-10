import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { app } from "electron";

/**
 * ============================================================
 * VSmart AI - SQLite Database
 * ============================================================
 *
 * Development:
 *   Database -> project working directory
 *
 * Production / Installed App:
 *   Database -> Electron userData directory
 *
 * This prevents SQLite from trying to write inside:
 *   C:\Program Files\VSmart AI\
 *
 * which causes:
 *   SqliteError: unable to open database file
 * ============================================================
 */

// ------------------------------------------------------------
// Database directory
// ------------------------------------------------------------

const dataDir = app.isPackaged
  ? app.getPath("userData")
  : process.cwd();

// Make sure the directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, {
    recursive: true,
  });
}

// ------------------------------------------------------------
// Database file
// ------------------------------------------------------------

const dbPath = path.join(
  dataDir,
  "vsmart-memory.db"
);

if (process.env.NODE_ENV !== "production") {
  console.log(
    "[VSmart AI] SQLite database path:",
    dbPath
  );
}

// ------------------------------------------------------------
// Open database
// ------------------------------------------------------------

const db = new Database(dbPath);

// Optional SQLite performance/safety settings
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ============================================================
// MEMORY TABLE
// ============================================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// ============================================================
// LONG-TERM MEMORY FACTS TABLE
// ============================================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS memory_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact_key TEXT UNIQUE,
    fact_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// ============================================================
// BASIC MEMORY FUNCTIONS
// ============================================================

export function saveMemory(
  key: string,
  value: string
): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      key,
      value
    )
    VALUES (?, ?)
    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value
  `);

  stmt.run(
    key,
    value
  );
}

// ------------------------------------------------------------

export function getMemory(
  key: string
): string | null {
  const stmt = db.prepare(`
    SELECT value
    FROM memories
    WHERE key = ?
  `);

  const result = stmt.get(key) as
    | { value: string }
    | undefined;

  return result?.value ?? null;
}

// ------------------------------------------------------------

export function getAllMemory() {
  return db.prepare(`
    SELECT *
    FROM memories
    ORDER BY created_at DESC
  `).all();
}

// ============================================================
// LONG-TERM "FACTS ABOUT USER"
// ============================================================

export interface MemoryFact {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------

export function saveFact(
  key: string,
  value: string
): void {
  const normalizedKey = key
    .trim()
    .toLowerCase();

  if (!normalizedKey) {
    return;
  }

  db.prepare(`
    INSERT INTO memory_facts (
      fact_key,
      fact_value
    )
    VALUES (?, ?)

    ON CONFLICT(fact_key)
    DO UPDATE SET
      fact_value = excluded.fact_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    normalizedKey,
    value
  );
}

// ------------------------------------------------------------

export function getFact(
  key: string
): string | null {
  const normalizedKey = key
    .trim()
    .toLowerCase();

  if (!normalizedKey) {
    return null;
  }

  const result = db.prepare(`
    SELECT fact_value
    FROM memory_facts
    WHERE fact_key = ?
  `).get(normalizedKey) as
    | { fact_value: string }
    | undefined;

  return result?.fact_value ?? null;
}

// ------------------------------------------------------------

export function getAllFacts(): MemoryFact[] {
  return db.prepare(`
    SELECT
      fact_key AS key,
      fact_value AS value,
      created_at,
      updated_at
    FROM memory_facts
    ORDER BY updated_at DESC
  `).all() as MemoryFact[];
}

// ------------------------------------------------------------

export function deleteFact(
  key: string
): boolean {
  const normalizedKey = key
    .trim()
    .toLowerCase();

  if (!normalizedKey) {
    return false;
  }

  const result = db.prepare(`
    DELETE FROM memory_facts
    WHERE fact_key = ?
  `).run(normalizedKey);

  return result.changes > 0;
}

// ============================================================
// TF-IDF TOKENIZER
// ============================================================

function tokenize(
  text: string
): string[] {
  return text
    .toLowerCase()
    .replace(
      /[^a-z0-9\u0900-\u097F\s]/g,
      " "
    )
    .split(/\s+/)
    .filter(
      (word) => word.length > 1
    );
}

// ============================================================
// FACT SEARCH RESULT
// ============================================================

export interface FactMatch {
  key: string;
  value: string;
  score: number;
}

// ============================================================
// TF-IDF SEARCH
// ============================================================

export function searchFacts(
  query: string,
  topK = 5,
  minScore = 0.05
): FactMatch[] {
  const facts = getAllFacts();

  if (facts.length === 0) {
    return [];
  }

  // ----------------------------------------------------------
  // Create documents
  // ----------------------------------------------------------

  const docs = facts.map(
    (fact) =>
      tokenize(
        `${fact.key} ${fact.value}`
      )
  );

  // ----------------------------------------------------------
  // Tokenize query
  // ----------------------------------------------------------

  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return [];
  }

  const N = docs.length;

  // ----------------------------------------------------------
  // Document frequency
  // ----------------------------------------------------------

  const df = new Map<
    string,
    number
  >();

  for (const doc of docs) {
    const seen = new Set(doc);

    for (const term of seen) {
      df.set(
        term,
        (df.get(term) ?? 0) + 1
      );
    }
  }

  // ----------------------------------------------------------
  // Inverse document frequency
  // ----------------------------------------------------------

  const idf = (
    term: string
  ): number => {
    return (
      Math.log(
        (N + 1) /
        ((df.get(term) ?? 0) + 1)
      ) + 1
    );
  };

  // ----------------------------------------------------------
  // TF-IDF vector
  // ----------------------------------------------------------

  function tfVector(
    tokens: string[]
  ): Map<string, number> {
    const tf = new Map<
      string,
      number
    >();

    for (const token of tokens) {
      tf.set(
        token,
        (tf.get(token) ?? 0) + 1
      );
    }

    const vec = new Map<
      string,
      number
    >();

    if (tokens.length === 0) {
      return vec;
    }

    for (
      const [term, count]
      of tf
    ) {
      vec.set(
        term,
        (count / tokens.length) *
          idf(term)
      );
    }

    return vec;
  }

  // ----------------------------------------------------------
  // Cosine similarity
  // ----------------------------------------------------------

  function cosineSim(
    a: Map<string, number>,
    b: Map<string, number>
  ): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    // Norm A
    for (const value of a.values()) {
      normA += value * value;
    }

    // Norm B
    for (const value of b.values()) {
      normB += value * value;
    }

    // Dot product
    for (
      const [term, valueA]
      of a
    ) {
      const valueB = b.get(term);

      if (valueB !== undefined) {
        dot += valueA * valueB;
      }
    }

    if (
      normA === 0 ||
      normB === 0
    ) {
      return 0;
    }

    return (
      dot /
      (
        Math.sqrt(normA) *
        Math.sqrt(normB)
      )
    );
  }

  // ----------------------------------------------------------
  // Query vector
  // ----------------------------------------------------------

  const queryVec =
    tfVector(queryTokens);

  // ----------------------------------------------------------
  // Score documents
  // ----------------------------------------------------------

  const scored = facts.map(
    (fact, index) => {
      const factVec =
        tfVector(
          docs[index]
        );

      return {
        key: fact.key,
        value: fact.value,
        score: cosineSim(
          queryVec,
          factVec
        ),
      };
    }
  );

  // ----------------------------------------------------------
  // Filter + sort + limit
  // ----------------------------------------------------------

  return scored
    .filter(
      (item) =>
        item.score >= minScore
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, topK);
}

// ============================================================
// DATABASE CLOSE
// ============================================================

export function closeDatabase(): void {
  if (db.open) {
    db.close();
  }
}