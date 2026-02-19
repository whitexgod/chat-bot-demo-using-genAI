import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type AppRole = "admin" | "user";

type SeedUser = {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
};

const SEED_USERS: SeedUser[] = [
  {
    email: "seed.admin@example.com",
    password: "SeedAdmin#123",
    displayName: "Seed Admin",
    role: "admin",
  },
  {
    email: "seed.alice@example.com",
    password: "SeedAlice#123",
    displayName: "Alice Seed",
    role: "user",
  },
  {
    email: "seed.bob@example.com",
    password: "SeedBob#123",
    displayName: "Bob Seed",
    role: "user",
  },
];

function loadDotEnv() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(process.cwd(), ".env"), join(scriptDir, ".env")];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      return readFileSync(envPath, "utf8");
    }
  }

  return "";
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
  const value = process.env[name] ?? fromDotEnv[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to your environment or .env file.`);
  }
  return value;
}

function dateDaysAgo(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function run() {
  const env = parseEnv(loadDotEnv());
  const supabaseUrl = mustGet("SUPABASE_URL", env);
  const serviceRoleKey = mustGet("SUPABASE_SERVICE_ROLE_KEY", env);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: existingUsers, error: listUsersError } =
    await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (listUsersError) throw listUsersError;

  const usersByEmail = new Map(
    existingUsers.users.map((u) => [u.email?.toLowerCase(), u.id]),
  );

  const seededUserIds: { id: string; role: AppRole }[] = [];

  for (const user of SEED_USERS) {
    const existingId = usersByEmail.get(user.email.toLowerCase());
    let userId = existingId;

    if (!userId) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { display_name: user.displayName },
      });
      if (error) throw error;
      userId = data.user.id;
      console.log(`Created auth user: ${user.email}`);
    } else {
      console.log(`Auth user already exists: ${user.email}`);
    }

    seededUserIds.push({ id: userId, role: user.role });
  }

  const profileRows = seededUserIds.map((u) => ({
    id: u.id,
    role: u.role,
  }));

  const { error: profilesError } = await supabase
    .from("profiles")
    .upsert(profileRows, { onConflict: "id" });
  if (profilesError) throw profilesError;

  const userIds = seededUserIds.map((u) => u.id);

  const { error: deleteTxError } = await supabase
    .from("transactions")
    .delete()
    .in("user_id", userIds);
  if (deleteTxError) throw deleteTxError;

  const merchants = ["Seed Grocery", "Seed Coffee", "Seed Taxi", "Seed Books"];
  const categories = ["groceries", "food", "transport", "shopping"];

  const txRows = userIds.flatMap((userId, userIndex) => {
    return Array.from({ length: 8 }, (_, i) => ({
      user_id: userId,
      amount: Number((10 + userIndex * 7 + i * 3.25).toFixed(2)),
      category: categories[i % categories.length],
      merchant: merchants[i % merchants.length],
      date: dateDaysAgo((userIndex + 1) * 2 + i),
    }));
  });

  const { error: insertTxError } = await supabase
    .from("transactions")
    .insert(txRows);
  if (insertTxError) throw insertTxError;

  const { data: existingChats, error: existingChatsError } = await supabase
    .from("chats")
    .select("id")
    .in("user_id", userIds);
  if (existingChatsError) throw existingChatsError;

  const chatIdsToDelete = (existingChats ?? []).map((c) => c.id);

  if (chatIdsToDelete.length > 0) {
    const { error: deleteChatsError } = await supabase
      .from("chats")
      .delete()
      .in("id", chatIdsToDelete);
    if (deleteChatsError) throw deleteChatsError;
  }

  const newChatsPayload = userIds.map((user_id) => ({ user_id }));
  const { data: insertedChats, error: insertChatsError } = await supabase
    .from("chats")
    .insert(newChatsPayload)
    .select("id, user_id");
  if (insertChatsError) throw insertChatsError;

  const messages = (insertedChats ?? []).flatMap((chat) => [
    {
      chat_id: chat.id,
      role: "user",
      content: "How much did I spend this month?",
    },
    {
      chat_id: chat.id,
      role: "assistant",
      content:
        "You spent $428.75 this month. Most spending was in groceries and food.",
    },
    {
      chat_id: chat.id,
      role: "user",
      content: "Show totals by category.",
    },
    {
      chat_id: chat.id,
      role: "assistant",
      content:
        "Category totals: groceries $180.25, food $112.50, transport $76.00, shopping $60.00.",
    },
  ]);

  const { error: insertMessagesError } = await supabase
    .from("messages")
    .insert(messages);
  if (insertMessagesError) throw insertMessagesError;

  console.log("Seed complete.");
  console.log(`Profiles upserted: ${profileRows.length}`);
  console.log(`Transactions inserted: ${txRows.length}`);
  console.log(`Chats inserted: ${insertedChats?.length ?? 0}`);
  console.log(`Messages inserted: ${messages.length}`);
}

run().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
