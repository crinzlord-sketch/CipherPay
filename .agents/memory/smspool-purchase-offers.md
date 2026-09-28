---
name: SMSPool purchase offers
description: How to safely handle SMSPool offers that change between catalog and purchase.
---

SMSPool pricing can list a valid service/country offer on a specific pool that becomes unavailable before the purchase request. A purchase should retry without the fixed pool while retaining the quoted `max_price`, so another available pool may satisfy the order without increasing the user's debit.

**Why:** The provider can return a 422 or `OUT_OF_STOCK`/`PRICE_NOT_FOUND` after the catalog succeeds; forcing the originally listed pool turns a transient provider change into an unnecessary refund.

**How to apply:** Treat the wallet debit as the ceiling. Prefer provider error bodies over generic HTTP errors, and never retry in a way that permits a provider price above the amount already charged.