---
name: Gift cards cart & popularity
description: How the gift cards screen does "most popular" and cart checkout against the existing single-order API.
---

The gift cards mobile screen (`app/giftcards.tsx`) is browse → country → config → cart → result.

- **"Most popular" is a curated keyword list, not provider data.** Reloadly exposes no popularity field, so a `POPULAR_KEYWORDS` array (amazon, apple, steam, playstation, …) is matched against brand names and ordered by keyword position. Edit that list to change the rail.
  **Why:** provider has no popularity signal; a curated list is the only stable source.

- **Cart is client-side only; there is no cart/batch API.** Checkout loops the existing `POST /giftcards/order` once per cart line (sequential — each call debits the wallet and counts toward the server's daily order limit). Successful lines are removed from the cart; failed lines stay so the user can retry. The result screen shows per-line success/failure.
  **How to apply:** if you add server-side cart persistence or a batch endpoint later, replace the client loop in `checkout()`; don't expect an existing one.
