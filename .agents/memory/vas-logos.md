---
name: Self-hosted VAS logos
description: How mobile-network + bill-provider brand logos are stored and served
---

# Self-hosted VAS logos

Brand logos (mobile networks + bill providers) are committed image files under `artifacts/api-server/assets/logos/<id>.<ext>` (mixed extensions: png/jpg/webp). At startup a scan builds an id→filename map; `logoPath(id)` returns `/api/assets/logos/<file>` or null. A public static route (regex-validated, traversal-guarded, cache 86400) serves them BEFORE the `/api` auth middleware. Endpoints (`/airtime/networks`, `/bills/providers`) return the relative path; the mobile app renders it via `mediaUrl()` with a text/monogram fallback when null.

**The filename stem must match the VAS id EXACTLY, case-sensitive.** The scan keeps the original case (`mtnFibre.png` → id `mtnFibre`, `ipNX.png` → id `ipNX`). A case mismatch silently yields `logo: null` and the UI falls back to a monogram — no error, just a missing logo.
**Why:** the id→filename map keys on the literal filename stem; there is no normalization.
**How to apply:** when adding a new provider/network, name its logo file with the precise `id` from the provider list (including camelCase) or the logo won't resolve.
