---
name: Helios Backend Architecture
description: Key architectural facts about the Helios backend — dual DB connections, auth state, known gaps, collection names
type: project
---

Two-server backend: api.ts (port 8000, Express, MongoDB) and server.ts (port 3000, MCP protocol).

Dual DB connection pattern: native MongoClient (crud.js) + Mongoose (models/) both connect to the same MONGODB_URI at startup. The native driver uses `myDatabase.users` collection for saved servers (misleading name — these are API servers, not user accounts). Mongoose uses separate collections: `users`, `api_keys`, `connections`.

**Why:** This dual-driver pattern was inherited — crud.js was built first as a learning artifact, Mongoose models were added later for auth. They are not coordinated.

**How to apply:** Any audit finding about DB inconsistency, connection race conditions, or collection naming confusion should reference this dual-driver pattern as the root cause. The `users` collection name collision between crud.js servers and Mongoose auth users is a real production risk.

Current auth state (as of 2026-04-03):
- JWT auth exists (auth.controller.ts, auth.middleware.ts, jwt.service.ts)
- Saved servers are NOT scoped per user — getAllMongo() returns everything to everyone
- No email verification exists
- No persistent login (no httpOnly cookie, no refresh token)
- JWT_SECRET is a plaintext env var, no rotation mechanism

Upcoming features being audited: per-user server scoping, Gmail OTP email verification, persistent login (JWT cookie), account page UI.
