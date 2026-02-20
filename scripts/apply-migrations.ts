import { Client } from "pg";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = join(scriptDir, "..");
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return "";
  return readFileSync(envPath, "utf8");
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function mustGet(name: string, fromDotEnv: Record<string, string>) {
  const value = fromDotEnv[name] ?? process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to your environment or .env file.`);
  }
  return value;
}

function getMigrationsDir() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return join(scriptDir, "..", "supabase", "migrations");
}

function listMigrationFiles(dir: string) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function migrationVersion(filename: string) {
  return filename.split("_")[0].replace(".sql", "");
}

function stripSslMode(connectionString: string) {
  return connectionString
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/([?&])uselibpqcompat=[^&]*/gi, "$1")
    .replace(/[?&]$/, "");
}

function getConnectionConfig(env: Record<string, string>) {
  const rawConnectionString = mustGet("SUPABASE_DB_URL", env);
  const connectionString = stripSslMode(rawConnectionString);
  const parsed = new URL(connectionString);
  const passwordOverride = env.SUPABASE_DB_PASSWORD;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || "5432"),
    user: decodeURIComponent(parsed.username),
    password: passwordOverride ?? decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || "postgres"),
    ssl: { rejectUnauthorized: false },
  };
}

async function run() {
  const env = parseEnv(loadDotEnv());
  const connectionConfig = getConnectionConfig(env);
  const migrationsDir = getMigrationsDir();
  const files = listMigrationFiles(migrationsDir);

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const client = new Client(connectionConfig);

  await client.connect();

  try {
    await client.query(`
      create table if not exists public.app_migrations (
        version text primary key,
        filename text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ version: string }>(
      "select version from public.app_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));

    for (const filename of files) {
      const version = migrationVersion(filename);
      if (applied.has(version)) {
        console.log(`Skipping ${filename} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(migrationsDir, filename), "utf8");
      console.log(`Applying ${filename}...`);

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into public.app_migrations (version, filename) values ($1, $2)",
          [version, filename],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    console.log("Migration apply complete.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Migration apply failed:", error);
  process.exit(1);
});
