---
name: VAS profit margin
description: How CipherPay adds profit on top of provider (pass-through) VAS prices.
---

# VAS profit margin

Data plans and airtime carry a **flat ₦50 profit margin** (`VAS_PROFIT_FEE` constant in `artifacts/api-server/src/routes/services.ts`).

- **Data:** the markup is baked into the plan `price` returned by `getDataPlans()`, so the displayed price, the wallet debit in `/data/buy`, and the refund-on-failure all use the same marked-up number automatically. The provider is still paid its own `pkg.amount` (we buy by `packageCode`, not by price).
- **Airtime:** `/airtime/buy` debits `amount + VAS_PROFIT_FEE`; the delivered face value sent to the provider stays `amount`. Both `refundFailed` paths must refund the full `charge` (amount + fee), not just `amount`. The mobile airtime screen surfaces this as a "Service fee" row + total so the user sees what they pay.

**Why:** the user explicitly wanted to earn profit on VAS — provider prices were previously pure pass-through (₦0 profit). Decision: flat ₦50, applied to data + airtime (not SMS or social boosts).

**How to apply:** keep debit and all refund paths in lockstep on the same charge amount. If the margin changes or extends to other VAS (bills, gift cards), update `VAS_PROFIT_FEE` and ensure any new flow surfaces the fee to the user before charging.
