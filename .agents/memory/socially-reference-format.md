---
name: socially.ng reference format
description: Exact reference-length constraints for socially.ng provider calls (data buy vs SMS)
---

# socially.ng `reference` length constraints

socially.ng's data buy endpoint (`/pay/bills/buy/data-bundle`) requires the `reference`
field to be **EXACTLY 25 numeric digits**. Anything else (e.g. an alphanumeric
`DAT<id>-<timestamp>`) returns HTTP 422 "reference must be 25 digits", which made every
data purchase fail and auto-refund.

**Why:** the failure is silent at compile time — the reference is just a string — so a
wrong format only shows up at runtime as "Data delivery failed. You have been refunded."

**How to apply:** generate references for socially data buys with the `numericReference(txId)`
helper in `services.ts` (timestamp(13) + zero-padded txId(6) + random(6) = 25 digits).
SMS verification's `buyNumber` is more lenient — its reference only needs ≥10 chars — so the
same helper is fine there but not required.
