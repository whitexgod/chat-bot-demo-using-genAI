Financial AI System Architecture – Client Explanation

1. High-Level Overview (What the client should understand first)

“This system allows users to securely chat with an AI assistant that can answer financial questions and analyze transaction data—without ever giving the AI direct access to the database.”

The architecture is designed around three core principles:

Security-first data access

Controlled AI behavior

Full auditability of AI actions

2. User & Frontend Layer (Left side of the diagram)
   User Browser

This is where the end user interacts using a web browser.

Frontend Application (Next.js)

The frontend has two main interfaces:

Authentication UI

Handles sign-up and sign-in securely.

AI Chat Interface

Where users ask natural language questions like:

“What were my total expenses last month?”

“Show my highest transactions this year.”

The frontend never talks directly to the database.
All requests go through the backend platform.

3. Backend Platform – Supabase (Center of the diagram)

This is the control layer of the entire system.

Supabase Authentication

Validates the user’s identity using secure tokens.

Determines the user’s role (for example: normal user vs admin).

This ensures no unauthenticated or unauthorized request can proceed.

AI Orchestration – Edge Function (financial-chat)

This is the most important component.

Think of it as:

“A secure AI gateway that decides what the AI is allowed to do.”

The Edge Function:

Receives user requests from the frontend

Applies multiple safety and validation stages

Communicates with the AI model

Controls all database access

4. Middleware-Like AI Pipeline (Right side of the diagram)

Although this isn’t traditional middleware, the Edge Function works in clearly defined stages.

Stage 1: Authentication & Authorization

Verifies the user’s identity.

Resolves user role before any data operation.

Blocks access immediately if validation fails.

✅ Security gate before AI or database access

Stage 2: Planner (AI Intent Classification)

The AI first decides:

Is this a normal chat question, or

A financial data query?

If it’s a financial query:

The AI generates a query plan, not raw execution.

✅ AI plans, but does not execute

Stage 3: Query Builder & SQL Sanitization

Before anything touches the database:

Only SELECT queries are allowed

No updates, deletes, inserts, or schema changes

No multiple queries or comments

Strict limits on result size

Non-admin users can only see their own data

✅ Prevents data leaks and malicious queries

Stage 4: Execution Guard

Even validated queries cannot run directly.

They must go through a secure database function (execute_query).

This function itself allows only safe reads.

✅ Double-layer execution protection

Stage 5: Observability & Audit Logs

Every AI-generated query is logged:

Generated

Successful

Failed

Execution time

Row count or error

This creates:

Full audit trail

Compliance readiness

Debugging transparency

✅ Nothing happens silently

Stage 6: Response Summarization

Raw database results are transformed into:

Clear summaries

Key financial metrics

Human-readable tables

Currency formatting is normalized (INR).

If AI summarization fails:

The system falls back to a transparent data table.

✅ Reliable output, no broken responses

5. AI Layer (Right side)
   Private LLM (Ollama)

Runs as a private AI model

Has no direct database access

Only receives:

User intent

Safe query plans

Query results for summarization

The AI cannot bypass system rules. It is fully controlled.

6. Data Layer (Bottom-Center)
   Secure Financial Database

Stores:

User profiles

Transactions

Chat history

AI query logs

The database is:

Accessed only through controlled backend logic

Never exposed to frontend or AI directly

7. Final Response to User

The user receives:

A clear AI reply

Structured financial data

Chat history continuity

All without compromising:

Security

Data privacy

System stability
