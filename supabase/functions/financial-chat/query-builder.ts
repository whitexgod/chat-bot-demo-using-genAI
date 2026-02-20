import type { QueryPlan } from "./schemas.ts";

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildQuery(
  plan: QueryPlan,
  access: { requesterUserId: string; isAdmin: boolean },
) {
  const metricExpr =
    plan.metric === "count" ? "COUNT(*)" : `${plan.metric.toUpperCase()}(amount)`;

  const selectClause = plan.group_by
    ? `${plan.group_by}, ${metricExpr} AS value`
    : `${metricExpr} AS value`;

  const conditions: string[] = ["true"];
  if (!access.isAdmin) {
    conditions.push(`user_id = ${sqlLiteral(access.requesterUserId)}::uuid`);
  }
  const filters = plan.filters;

  if (filters?.category) conditions.push(`category = ${sqlLiteral(filters.category)}`);
  if (filters?.merchant) conditions.push(`merchant = ${sqlLiteral(filters.merchant)}`);
  if (filters?.date_from) conditions.push(`date >= ${sqlLiteral(filters.date_from)}`);
  if (filters?.date_to) conditions.push(`date <= ${sqlLiteral(filters.date_to)}`);

  const groupClause = plan.group_by ? `GROUP BY ${plan.group_by}` : "";

  return `
    SELECT ${selectClause}
    FROM public.transactions
    WHERE ${conditions.join(" AND ")}
    ${groupClause}
    LIMIT 500
  `;
}
