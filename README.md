# Financial AI Chatbot - Local Run Guide

This repo has:
- Backend: Supabase (Auth, Postgres, Edge Function `financial-chat`)
- Frontend: Next.js app in `financial-ai-frontend/`
- Frontend container: `docker-compose.yml`

## Prerequisites

- Docker Desktop (running)
- Node.js 20+
- Supabase CLI (`supabase`)

## 1) Environment Setup

Create/update root `.env` with at least:

```env
SUPABASE_URL=...
SUPABASE_DB_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
OLLAMA_BASE_URL=...
OLLAMA_MODEL=...

# Needed by docker-compose frontend service:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
# or use NEXT_PUBLIC_SUPABASE_ANON_KEY instead
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Recommended mapping:
- `NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = SUPABASE_ANON_KEY`

## 2) Start Supabase

If you are running Supabase locally (Docker-based via CLI):

```bash
supabase start
```

If your `.env` points to a hosted Supabase project, skip this step.

## 3) Apply Migrations

From repo root:

```bash
npm install
npm run migrate:apply
```

## 4) Seed Users + Sample Data

From repo root:

```bash
node --experimental-strip-types seed.ts
```

This creates:
- users in Supabase Auth
- `profiles` role mappings
- sample `transactions`
- sample `chats` and `messages`

## 5) Start Frontend with Docker

From repo root:

```bash
docker compose up -d
```

Frontend will be available at:
- http://localhost:3000

To stop:

```bash
docker compose down
```

## 6) Login with Seed Credentials

Use any of these on the login page:

1. Admin user
   - Email: `seed.admin@example.com`
   - Password: `SeedAdmin#123`
2. Regular user
   - Email: `seed.alice@example.com`
   - Password: `SeedAlice#123`
3. Regular user
   - Email: `seed.bob@example.com`
   - Password: `SeedBob#123`

## Useful Commands

- Re-run seed data:
```bash
node --experimental-strip-types seed.ts
```

- View frontend logs:
```bash
docker compose logs -f financial-ai-frontend
```

- Rebuild/restart frontend container:
```bash
docker compose up -d --force-recreate
```
