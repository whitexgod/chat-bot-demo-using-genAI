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

function round2(value: number) {
  return Number(value.toFixed(2));
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

  const expenseMerchants = [
    "Seed Grocery",
    "Seed Coffee",
    "Seed Taxi",
    "Seed Books",
    "Seed Pharmacy",
    "Seed Utility",
    "Seed Fuel",
    "Seed Cinema",
  ];
  const expenseCategories = [
    "groceries",
    "food",
    "transport",
    "shopping",
    "health",
    "utilities",
    "fuel",
    "entertainment",
  ];

  const incomeMerchants = ["Seed Payroll", "Seed Cashback", "Seed Refund"];
  const incomeCategories = ["salary", "cashback", "refund"];
  const expenseCountPerUser = 55;

  const txRows = userIds.flatMap((userId, userIndex) => {
    const rows: Array<{
      user_id: string;
      amount: number;
      debit: number;
      credit: number;
      category: string;
      merchant: string;
      date: string;
    }> = [];

    let balance = 0;

    const addCredit = (
      credit: number,
      category: string,
      merchant: string,
      daysAgo: number,
    ) => {
      const roundedCredit = round2(credit);
      rows.push({
        user_id: userId,
        amount: roundedCredit,
        debit: 0,
        credit: roundedCredit,
        category,
        merchant,
        date: dateDaysAgo(daysAgo),
      });
      balance = round2(balance + roundedCredit);
    };

    const addDebit = (
      debit: number,
      category: string,
      merchant: string,
      daysAgo: number,
    ) => {
      const roundedDebit = round2(debit);
      rows.push({
        user_id: userId,
        amount: round2(-roundedDebit),
        debit: roundedDebit,
        credit: 0,
        category,
        merchant,
        date: dateDaysAgo(daysAgo),
      });
      balance = round2(balance - roundedDebit);
    };

    addCredit(5200 + userIndex * 600, "salary", "Seed Payroll", 120 - userIndex);

    for (let i = 0; i < expenseCountPerUser; i++) {
      if (i > 0 && i % 14 === 0) {
        const bonus = 1200 + userIndex * 200 + (i % 3) * 175;
        const incomeIndex = Math.floor(i / 14);
        const incomeCategory = incomeCategories[incomeIndex % incomeCategories.length];
        const incomeMerchant = incomeMerchants[incomeIndex % incomeMerchants.length];
        addCredit(bonus, incomeCategory, incomeMerchant, 110 - i);
      }

      let debit = 28 + ((i * 17 + userIndex * 13) % 95);
      debit = round2(debit + (i % 4) * 0.75);

      if (balance - debit < 30) {
        const topUp = round2(900 + userIndex * 150 + (i % 5) * 60);
        addCredit(topUp, "salary", "Seed Payroll", 109 - i);
      }

      if (balance - debit < 0) {
        debit = round2(Math.max(5, balance));
      }

      addDebit(
        debit,
        expenseCategories[i % expenseCategories.length],
        expenseMerchants[i % expenseMerchants.length],
        108 - i,
      );
    }

    if (balance < 0) {
      throw new Error(`Generated negative balance for user ${userId}`);
    }

    return rows;
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
