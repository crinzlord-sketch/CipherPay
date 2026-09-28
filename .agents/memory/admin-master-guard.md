---
name: Admin master guard
description: The bootstrap admin is protected from removal while delegated admins can be removed.
---

The bootstrap/master admin must never be removable from the admin console or any alternate user-deletion path. Other admin accounts may be removed by an authenticated admin, but the current session should not remove itself.

**Why:** Removing the bootstrap account could strand the product without a guaranteed recovery administrator.

**How to apply:** Keep the server-side guard authoritative; the UI should show the protected state and hide removal controls for the master/current session.