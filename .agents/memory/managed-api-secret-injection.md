---
name: Managed API secret injection
description: Runtime behavior when Replit secret entries exist but an artifact-managed API workflow does not receive them.
---

Secure entries alone do not prove that an artifact-managed API process can read the values. Confirm process startup logs and a safe health/provider check after every environment change.

**Why:** The API workflow can start successfully while reporting required email, admin, provider, or proxy variables as missing, even when the secret manager reports those keys as present.

**How to apply:** Never copy credentials into project files or artifact TOML. Diagnose the managed workflow's environment propagation, securely re-save credentials when the process still cannot see them, restart the workflow, and keep provider verification separate from the basic health check.