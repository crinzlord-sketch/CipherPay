---
name: Theme ownership
description: Where CipherPay keeps global light/dark theme state and how settings should update it.
---

# Theme ownership

The web app owns the document-level theme class at the application root. The Settings page reads and persists the explicit light/dark preference, but should not be the only place that applies the global class.

**Why:** Route-level theme effects made entering Settings appear to change the entire app unexpectedly and left theme behavior tied to that page's mount lifecycle.

**How to apply:** Keep the root theme synchronisation authoritative. Settings controls may update the class immediately after an explicit user action, but should not infer a dark theme from system appearance or apply a route-mount side effect.