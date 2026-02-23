import { QueryPlanSchema } from "./schemas.ts";

const MAX_LIMIT = 500;
const FORBIDDEN_SQL_TOKENS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "create",
  "grant",
  "revoke",
  "copy",
  "call",
  "do",
  "execute",
  "refresh",
  "merge",
  "vacuum",
  "analyze",
  "set",
  "reset",
  "show",
];

function normalizeSql(sql: string) {
  return sql.trim().replace(/;+\s*$/, "");
}

function stripStringLiterals(sql: string) {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\$[A-Za-z0-9_]*\$(?:[\s\S]*?)\$[A-Za-z0-9_]*\$/g, "$$");
}

function ensureNoCommentsOrSemicolons(sql: string) {
  if (/--/.test(sql) || /\/\*/.test(sql) || /\*\//.test(sql)) {
    throw new Error("SQL comments are not allowed.");
  }
  if (/;/.test(sql)) {
    throw new Error("Multiple statements are not allowed.");
  }
}

function ensureReadOnlySelect(sql: string) {
  const normalized = normalizeSql(sql);
  ensureNoCommentsOrSemicolons(normalized);

  const lower = normalized.toLowerCase();
  if (!/^\s*select\b/.test(lower)) {
    throw new Error("Only SELECT queries are allowed.");
  }

  const sqlWithoutStrings = stripStringLiterals(lower);
  const keywordPattern = new RegExp(`\\b(${FORBIDDEN_SQL_TOKENS.join("|")})\\b`, "i");
  if (keywordPattern.test(sqlWithoutStrings)) {
    throw new Error("Only read-only SELECT SQL is allowed.");
  }

  return normalized;
}

function ensureAllowedTables(sql: string, userId: string, isAdmin: boolean) {
  if (isAdmin) return sql;

  const fromJoinTables = Array.from(
    sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w.]*)/gi),
    (m) => m[1].toLowerCase(),
  );

  if (
    fromJoinTables.length === 0 ||
    fromJoinTables.some((table) => table !== "public.transactions" && table !== "transactions")
  ) {
    throw new Error("Non-admin users can query only public.transactions.");
  }

  const userIdPattern = new RegExp(
    `\\buser_id\\b\\s*=\\s*'${userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'(?:\\s*::\\s*uuid)?\\b`,
    "i",
  );
  if (!userIdPattern.test(sql)) {
    throw new Error("Non-admin SQL must include own user_id scope.");
  }

  return sql;
}

function enforceSafeLimit(sql: string) {
  const matches = Array.from(sql.matchAll(/\blimit\s+(\d+)\b/gi));
  if (matches.length === 0) {
    return `${sql} LIMIT ${MAX_LIMIT}`;
  }

  const lastLimit = Number(matches[matches.length - 1][1]);
  if (!Number.isFinite(lastLimit) || lastLimit < 1 || lastLimit > MAX_LIMIT) {
    throw new Error(`LIMIT must be between 1 and ${MAX_LIMIT}.`);
  }
  return sql;
}

export function buildSafeReadQuery(
  modelSql: string,
  context: {
    userId: string;
    isAdmin: boolean;
  },
) {
  const parsed = QueryPlanSchema.parse({ sql: modelSql });
  const readOnlySql = ensureReadOnlySelect(parsed.sql);
  const scopedSql = ensureAllowedTables(readOnlySql, context.userId, context.isAdmin);
  return enforceSafeLimit(scopedSql);
}
