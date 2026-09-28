---
name: API auth identity pattern (x-user-id from JWT)
description: How the api-server authenticates requests; the client/middleware contract that broke login
---

The api-server route handlers identify the user by reading `req.headers["x-user-id"]` (NOT by decoding the JWT themselves). The `app.use("/api", ...)` middleware in `artifacts/api-server/src/app.ts` is responsible for verifying the Bearer JWT (user OR admin token) and **setting** `x-user-id` to the verified id before routes run.

**Why this matters:** The mobile client (`apiCall` in `contexts/AuthContext.tsx`) only sends `Authorization: Bearer <jwt>` — it never sends `x-user-id`. If the middleware only *validates* a client-supplied `x-user-id` (and no-ops when it's absent) instead of *deriving* it from the token, every authed route 401s. That caused the login loop: post-login remount → `/auth/me` 401 → token cleared → bounced to login.

**How to apply:** The Bearer token is the single source of truth. Middleware must overwrite `x-user-id` from the verified token. Keep the anti-IDOR checks: a client-supplied `x-user-id` that mismatches the token → 403; `x-user-id` with no token → 401. Never trust a client-set `x-user-id`.
