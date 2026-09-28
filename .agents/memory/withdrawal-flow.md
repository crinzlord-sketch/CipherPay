---
name: Withdrawal flow (manual payout)
description: How CipherPay withdrawals work end-to-end and the known debit race to be aware of.
---

# Withdrawal flow

Withdrawals are a **manual** payout flow (no Paystack transfer, no OTP):

1. Mobile `withdraw.tsx` POSTs `/wallet/withdraw` with bank + amount only. It does a client-side balance check (amount + tiered fee ≤ wallet balance) and an **optional** biometric 2FA gate (only when the user enabled tx-auth in SecurityContext).
2. Backend `/wallet/withdraw` debits the wallet up front (amount + fee) via `debitWallet`, then marks the tx `pending` with `metadata.awaitingApproval:true`.
3. Admin **approve** (`/admin/withdrawals/:id/approve`) does NOT call any provider — it CAS-claims the pending row (LIKE predicate on `"awaitingApproval":true`) and atomically sets `status:"success"` + `metadata.payoutMethod:"manual"`, then notifies the user "Withdrawal completed". The admin pays the bank out-of-band.
4. Admin **reject** refunds the wallet and marks `failed` (CAS-guarded on the same metadata flag).

## Known limitation — debit is not concurrency-safe

**`debitWallet` is read-check-write without a row lock/CAS, and inserts the tx as `success` then the route patches it to `pending`.**

**Why it matters:** two concurrent `/wallet/withdraw` calls can both pass the balance check and both create withdrawal txs, under-debiting the wallet (double-spend window). This race is **pre-existing** — it predates the manual-payout refactor and was not introduced by it. Left as-is intentionally per the "keep it simple" follow-up scope.

**How to apply:** if you ever harden withdrawals, make the debit atomic — a single conditional UPDATE (`balance >= amount+fee`) inside a DB transaction that also inserts the tx directly as `pending` with `awaitingApproval:true` (don't insert `success` then patch). Don't re-add server-side OTP unless explicitly asked; the user deliberately removed it.
