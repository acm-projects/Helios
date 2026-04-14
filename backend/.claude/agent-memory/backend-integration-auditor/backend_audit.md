---
name: Helios Backend Audit History
description: Running log of production-readiness findings per audit session, including resolved and open issues
type: project
---

## Session 1 (2026-04-14) — filterToolsByIntent + /api/spec/simplify + /api/sandbox/chat (Anthropic rewrite)

### BLOCKING (do not ship)
- **Mixed assistant content types in history**: text-only turns push a plain string, tool-calling turns push `message.content` array. Anthropic API will reject subsequent turns. Fix: always push `message.content` array. → `api.ts` ~line 338.

### HIGH (fix before sustained traffic)
- **Prompt injection via `authContext.oauth2Url`**: user-controlled string injected verbatim into Claude system prompt. → `api.ts` ~line 297.
- **Chat errors return HTTP 200**: outer catch appends error to history and returns 200 — invisible to APM. → `api.ts` ~line 434.
- **No timeout on `messageAI` Anthropic call**: default SDK timeout is 600s. Can hold Express worker 10 minutes per call. → `sandbox.ts` ~line 118.
- **No history validation**: history array taken from client with no role check, no length cap, no content null check. Malformed history causes Anthropic 400 that surfaces as our 500. → `api.ts` ~line 284.

### MEDIUM
- **No sessionId→userId ownership check**: `sessionId` from client not verified to belong to the requesting user. Cross-user session access possible.
- **No timeout on OAuth2 token exchange fetch**: external token server can hang handler. → `api.ts` ~line 592.
- **No catalog size cap on /api/spec/simplify**: unlimited catalog sent to Haiku. → `api.ts` ~line 114.
- **access_token type not validated before storage**: number/null could pass `!tokenData.access_token` check. → `api.ts` ~line 603.
- **specId unescaped in Content-Disposition**: quotes in specId produce malformed header. → `api.ts` ~line 559.
- **Anthropic SDK error message leaked in chat reply**: `err.message` visible to frontend user. → `api.ts` ~line 436.

### LOW
- **`err.message` without `instanceof Error` guard** in filterToolsByIntent and api.ts outer catch.
- **No request ID / userId in filterToolsByIntent logs** — unactionable in multi-tenant load.
- **`Promise.allSettled` rejected branch is dead code** — inner async always returns a string.
- **Redundant dotenv.config calls** in api.ts and sandbox.ts — idempotent with override:true, not a bug.

### Patterns to watch
- This codebase consistently omits timeouts on Anthropic SDK calls (filterToolsByIntent got it right; messageAI did not).
- Input validation is thorough on simple fields but absent on nested/complex objects (history array, authContext object).
- Error responses collapse to HTTP 200 inside the agentic loop's outer catch — recurring anti-pattern.
