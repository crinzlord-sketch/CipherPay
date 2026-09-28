---
name: Flutterwave funding flows
description: How CipherPay wallet funding works across bank-transfer and card, and the verify contract clients must honor.
---

# Wallet funding (Flutterwave)

Two funding methods, both keyed by a single `reference` on a pending `fund` transaction:

- **Bank transfer** (default): `POST /wallet/fund/bank-transfer` mints a temporary NUBAN via Flutterwave `POST /v3/charges?type=bank_transfer`. The user pays into it from their own bank app. Credited by the `charge.completed` webhook (matches ANY pending fund tx by `tx_ref`); the client also polls `/wallet/fund/verify`.
- **Card / USSD**: `POST /wallet/fund` returns a hosted-checkout link opened in a WebView.

## Ordering rule (money-safety)
Always insert the pending `fund` row in the DB **before** calling the provider to mint a NUBAN.
**Why:** if the NUBAN is created first and the DB insert then fails, the user could transfer into a real account that no webhook/verify can match → unrecoverable lost deposit. With the row first, a provider failure just marks that row `failed` and no NUBAN is ever shown.

## `/wallet/fund/verify` response contract (clients MUST handle all)
- `200 {status:"success", ...wallet}` — credited (authenticated owner also gets wallet fields).
- `200 {status:"failed", reference}` — already-failed row; this is NOT a thrown error, so client polling must branch on it explicitly and stop.
- `202 {status:"pending", error}` — non-terminal; keep polling, webhook will settle.
- `400 {error}` — first-seen terminal failure (the route flips the row to failed here).
- `404` / `502` — not found / verification error.
**How to apply:** the mobile `apiCall` only throws on `!res.ok`, so 200-with-`failed` slips through as success unless explicitly checked.

## Display labels
The bank-transfer funding UI/API response intentionally displays `bankName:"Flutterwave FMB"` and `beneficiaryName:"CipherPay Wallet Funding"` for every generated deposit account. The account number remains the temporary Flutterwave account returned for that deposit; do not replace it with a fixed account number.

## User-facing errors
All raw Flutterwave error reasons go through `friendlyFlwError()` in `flutterwave.ts` before reaching users (logged raw via `req.log`). Covers IP-whitelist, low merchant balance, duplicate, validation, timeout.
