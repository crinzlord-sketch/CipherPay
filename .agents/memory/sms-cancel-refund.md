---
name: SMS cancellation refunds
description: Safety rules for cancelling SMSPool activations and returning wallet funds
---

SMS activation cancellation must be enforced on the server after the 15-minute waiting window, must recheck the provider before cancelling, and must refund through the original wallet debit's idempotent status transition. Provider expiry discovered during polling must not mark the local activation cancelled or refund it; only an explicit user cancellation may do that. Customer history should omit cancelled activations.

**Why:** The client countdown is only a convenience; provider status can change while the user is waiting, and duplicate cancel requests must never create duplicate wallet credits.

**How to apply:** Keep the provider cancellation and original-transaction refund coupled to the authenticated activation. Treat received SMS codes as non-refundable, and preserve a retry/support path if provider cancellation or refund confirmation fails.