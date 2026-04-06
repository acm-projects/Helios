---
name: Recurring Audit Patterns — Helios Backend
description: Anti-patterns and vulnerability classes found in the Helios backend, tracked across audit sessions
type: project
---

## First audit (2026-04-03)

### Recurring patterns found:
1. **No auth on server CRUD routes** — GET/POST/DELETE /api/servers/* have zero auth enforcement. Any unauthenticated caller can read, write, or delete any saved server.
2. **Broad catch blocks that swallow error types** — auth.controller.ts login handler uses bare `catch {}` with no error logged, losing all diagnostic context.
3. **No input length/size limits beyond the 10mb JSON body limit** — specId, email, and catalog content are not individually bounded.
4. **Top-level await for both DB connections in api.ts** — if either connection fails, the process crashes with no retry or graceful degradation.
5. **crud.js uses untyped `collection` variable** — declared with `let collection` (no type, no null guard), so any function called before connectMongo() will throw a cryptic null-deref instead of a meaningful error.
6. **No rate limiting on auth endpoints** — register and login accept unlimited attempts; brute force is trivially possible.
7. **JWT expiry is 7 days with no refresh token mechanism** — once issued, a token cannot be revoked (no blocklist, no rotation).
8. **API keys stored in plaintext** — apiKey.model.ts stores `key` as a plain string with no encryption at rest.

### Modules consistently under-tested:
- crud.js (no tests at all)
- auth/auth.controller.ts (no tests, especially login brute-force and race conditions on register)
- /api/servers CRUD routes (no authorization enforcement, no tests)

## Second audit session (2026-04-03) — implementation guide written

### Features being built (in order):
1. Per-user server scoping (crud.js userId filtering + all route changes)
2. Email verification (EmailVerification model, nodemailer, OTP flow)
3. Persistent login (httpOnly cookie, cookie-parser, remember-me semantics)
4. Account page UI (Next.js App Router, React context, no localStorage)
5. Dual DB cleanup (Server Mongoose model replacing crud.js native driver)

### Key decisions recorded:
- Server Mongoose model collection name must be `servers` (not `users` — the current crud.js collision)
- Email verification uses 6-digit OTP stored as bcrypt hash, TTL index cleans up after 15min
- Cookie name: `helios_token`, httpOnly, SameSite=Lax, Secure in production
- Auth middleware reads cookie OR Authorization header (cookie wins for browser, header for API clients)
- "Remember me" = 7d maxAge; no "remember me" = session cookie (no maxAge)
- Migration of existing unscoped documents: one-time script sets userId = null, do NOT auto-assign
- Frontend auth state: React context populated from GET /api/auth/me on mount, no localStorage token
