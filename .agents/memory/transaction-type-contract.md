---
name: Transaction type & notification contract sync
description: Canonical enum-like string values shared between the API server and the mobile client that must stay byte-identical.
---

# Shared string contracts (CipherPay)

The mobile client (`artifacts/cipherboost-mobile`) keys filters and icon maps off raw
string values returned by the API server (`artifacts/api-server`). These are plain
strings, not a shared TS type, so a typo on either side silently breaks UX (a filter
matches nothing, an icon falls back) with NO typecheck error.

**Rule:** when adding/renaming a transaction type or a JSON field that the mobile app
reads, change BOTH sides in lockstep and grep the other package for the old string.

Known canonical values:
- Transaction `type`: `fund`, `transfer_in`, `transfer_out`, `withdraw`, `airtime`,
  `data`, `bill` (singular — NOT "bills"), `giftcard`, `social`, `sms`.
  - Credit types (show as green `+`): `fund`, `transfer_in`.
- Notifications unread endpoint `GET /notifications/unread-count` returns `{ unread: number }`
  (NOT `{ count }`).

**Why:** a real bug shipped where the mobile bills filter/icon used `"bills"` while the
backend writes `"bill"`, and the home unread badge read `.count` while the API returns
`.unread` — both compiled fine but were functionally dead.

**How to apply:** treat these strings as a contract; if you touch one, search the sibling
package (`rg "the-string"`) before considering the change done.
