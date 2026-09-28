---
name: Temporary email retention
description: Account-owned disposable inboxes renew while active, but the upstream provider can still purge them.
---

CipherPay stores temporary inbox addresses against the signed-in account and renews them before provider expiry. This improves continuity across devices and reloads, but it is not permanent storage: the upstream disposable-email service documents finite retention and may purge expired or unavailable inboxes.

**Why:** The provider exposes only short extensions for free inboxes and does not guarantee indefinite availability.

**How to apply:** Keep the limitation visible in product copy, use the provider WebSocket for prompt message updates with a conservative polling fallback, and let users remove/replace unavailable inboxes.