---
name: Flutterwave VAS migration
description: Operational constraints for airtime, data, and electricity bills on Flutterwave
---

# Flutterwave VAS (airtime + electricity)

Airtime, **electricity** bills, and **data bundles** run on Flutterwave (`FLUTTERWAVE_SECRET_KEY`, base `https://api.flutterwave.com/v3`). socially.ng only powers social boosts + SMS verification. Secret names can exist while their runtime values are empty; confirm startup sees the key before debugging provider logic.

## Data bundles (Flutterwave)
The data catalog is `GET /v3/bill-categories?data_bundle=1&country=NG`; network is inferred from each item's `biller_name` prefix (mtn/airtel/glo/9mobile|etisalat). A bundle is identified by its `item_code`, which is surfaced to clients as the plan `id` and re-resolved at buy time. Pay via `POST /v3/bills` with `type: item_code` (same endpoint/whitelist constraint as airtime).
**Catalog reads need NO IP whitelisting** — only the `/v3/bills` pay step does. So `/data/plans` works in dev even when `/data/buy` (and airtime/electricity pay) is IP-gated.
The flat ₦50 `VAS_PROFIT_FEE` markup is preserved: plan.price = Flutterwave amount + 50; the wallet debit and all refunds use plan.price, while Flutterwave is paid `plan.price - VAS_PROFIT_FEE`.

## IP whitelisting constraint (operational)
`POST /v3/bills` (the pay endpoint, used for both airtime and electricity) requires the **caller's egress IP** to be whitelisted in the Flutterwave dashboard. Until then it returns HTTP 400 "Please enable IP Whitelisting".
- Dev egress IP and prod egress IP **differ**. Prod needs a Reserved VM to get a stable egress IP to whitelist.
- This makes airtime/electricity *payment* untestable in dev until the dev egress IP is whitelisted. Validation (meter lookup) hits a different endpoint and may also be gated.

## validateBill must distinguish failure modes
**Why:** `flwGet` returns `{status, body}` and never throws. If `validateBill` only checks for `body.data.name`, a provider/auth/IP-whitelist failure (400/401) looks identical to a genuine "no such customer" — every meter lookup then falsely reports "meter not found".
**How to apply:** any Flutterwave GET wrapper that feeds a user-facing "not found" check must throw on non-2xx OR `body.status === "error"` so the route returns 502 (provider failure), reserving the 400 "not found" path for a real null name.
