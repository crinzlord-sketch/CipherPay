---
name: Email Pro delivery signals
description: Product semantics for per-user SMTP sending, accepted messages, and open tracking.
---

Email Pro must label SMTP provider acceptance separately from inbox delivery. An accepted SMTP submission confirms that the configured provider took the message, not that every recipient received it. An open signal only exists when the recipient's client loads the tracking image, and privacy features can suppress it.

**Why:** Arbitrary Gmail, Microsoft, Namecheap, and custom SMTP providers do not expose a universal, reliable inbox-delivery result through the sending connection.

**How to apply:** Keep accepted and opened as separate states in future UI, API, and analytics work. Add bounce/DSN handling as a separate capability rather than renaming accepted to delivered.