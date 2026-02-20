import type { QueryPlan } from "./schemas.ts";

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

const tableColumns: Record<string, Set<string>> = {
  "public.transactions": new Set([
    "id",
    "user_id",
    "amount",
    "debit",
    "credit",
    "category",
    "merchant",
    "date",
    "created_at",
  ]),
  "public.profiles": new Set(["id", "role", "created_at"]),
  "public.chats": new Set(["id", "user_id", "created_at"]),
  "public.messages": new Set(["id", "chat_id", "role", "content", "created_at"]),
  "public.ai_query_logs": new Set([
    "id",
    "user_id",
    "role",
    "chat_id",
    "status",
    "row_count",
    "duration_ms",
    "started_at",
    "finished_at",
    "created_at",
  ]),
};

const numericColumns: Record<string, Set<string>> = {
  "public.transactions": new Set(["amount", "debit", "credit"]),
  "public.profiles": new Set(),
  "public.chats": new Set(),
  "public.messages": new Set(),
  "public.ai_query_logs": new Set(["row_count", "duration_ms"]),
};

function columnAllowed(table: string, column: string) {
  return Boolean(tableColumns[table]?.has(column));
}

function addComparableRange(
  conditions: string[],
  table: string,
  column: string,
  minValue?: number,
  maxValue?: number,
) {
  if (!columnAllowed(table, column)) return;
  if (typeof minValue === "number") conditions.push(`${column} >= ${minValue}`);
  if (typeof maxValue === "number") conditions.push(`${column} <= ${maxValue}`);
}

export function buildQuery(
  plan: QueryPlan,
  access: { requesterUserId: string; isAdmin: boolean },
) {
  if (plan.operation !== "select") {
    throw new Error("Only read (SELECT) operations are allowed.");
  }

  const table = plan.from_table;
  const filters = plan.filters;
  const tableNumericColumns = numericColumns[table];
  const hasUserIdColumn = columnAllowed(table, "user_id");

  if (!access.isAdmin && table !== "public.transactions") {
    throw new Error("Non-admin users can query only public.transactions.");
  }

  const valueField = plan.value_field ?? (table === "public.transactions" ? "amount" : "row_count");
  if (plan.metric !== "count" && !tableNumericColumns?.has(valueField)) {
    throw new Error(`Field '${valueField}' is not a numeric column in ${table}`);
  }

  const metricExpr =
    plan.metric === "count"
      ? "COUNT(*)"
      : `${plan.metric.toUpperCase()}(${valueField})`;

  const selectClause = plan.group_by
    ? `${plan.group_by}, ${metricExpr} AS value`
    : `${metricExpr} AS value`;

  const conditions: string[] = ["true"];
  const limit = Math.min(Math.max(plan.limit ?? 100, 1), 500);
  const sortDir = (plan.sort_dir ?? "desc").toUpperCase();

  if (!access.isAdmin) {
    conditions.push(`user_id = ${sqlLiteral(access.requesterUserId)}::uuid`);
  } else if (filters?.user_id) {
    if (hasUserIdColumn) {
      conditions.push(`user_id = ${sqlLiteral(filters.user_id)}::uuid`);
    } else if (table === "public.profiles") {
      conditions.push(`id = ${sqlLiteral(filters.user_id)}::uuid`);
    } else if (table === "public.messages") {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM public.chats c
          WHERE c.id = chat_id
          AND c.user_id = ${sqlLiteral(filters.user_id)}::uuid
        )`,
      );
    }
  }

  if (filters?.id && columnAllowed(table, "id")) {
    conditions.push(`id = ${sqlLiteral(filters.id)}::uuid`);
  }
  if (filters?.chat_id && columnAllowed(table, "chat_id")) {
    conditions.push(`chat_id = ${sqlLiteral(filters.chat_id)}::uuid`);
  }
  if (filters?.category && columnAllowed(table, "category")) {
    conditions.push(`category = ${sqlLiteral(filters.category)}`);
  }
  if (filters?.merchant && columnAllowed(table, "merchant")) {
    conditions.push(`merchant = ${sqlLiteral(filters.merchant)}`);
  }
  if (filters?.role && columnAllowed(table, "role")) {
    conditions.push(`role = ${sqlLiteral(filters.role)}`);
  }
  if (filters?.status && columnAllowed(table, "status")) {
    conditions.push(`status = ${sqlLiteral(filters.status)}`);
  }

  const dateField = columnAllowed(table, "date")
    ? "date"
    : columnAllowed(table, "created_at")
      ? "created_at::date"
      : null;
  if (filters?.date_from && dateField) {
    conditions.push(`${dateField} >= ${sqlLiteral(filters.date_from)}`);
  }
  if (filters?.date_to && dateField) {
    conditions.push(`${dateField} <= ${sqlLiteral(filters.date_to)}`);
  }

  addComparableRange(conditions, table, "amount", filters?.min_amount, filters?.max_amount);
  addComparableRange(conditions, table, "debit", filters?.min_debit, filters?.max_debit);
  addComparableRange(conditions, table, "credit", filters?.min_credit, filters?.max_credit);
  addComparableRange(
    conditions,
    table,
    "duration_ms",
    filters?.min_duration_ms,
    filters?.max_duration_ms,
  );
  addComparableRange(
    conditions,
    table,
    "row_count",
    filters?.min_row_count,
    filters?.max_row_count,
  );

  if (plan.group_by && !columnAllowed(table, plan.group_by)) {
    throw new Error(`Cannot group by '${plan.group_by}' in ${table}`);
  }

  const groupClause = plan.group_by ? `GROUP BY ${plan.group_by}` : "";
  const requestedSortBy = plan.sort_by ?? "value";
  if (requestedSortBy !== "value" && !columnAllowed(table, requestedSortBy)) {
    throw new Error(`Cannot sort by '${requestedSortBy}' in ${table}`);
  }

  const orderByField = plan.group_by
    ? requestedSortBy === "value" || requestedSortBy === plan.group_by
      ? requestedSortBy
      : plan.group_by
    : "value";
  const orderClause = `ORDER BY ${orderByField} ${sortDir}`;

  return `
    SELECT ${selectClause}
    FROM ${table}
    WHERE ${conditions.join(" AND ")}
    ${groupClause}
    ${orderClause}
    LIMIT ${limit}
  `;
}
