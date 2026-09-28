# CipherPay

A Nigerian fintech website: wallet funding, instant P2P transfers by account number, external bank withdrawals, and VAS purchases (airtime, data, electricity, social boosts, SMS verification numbers).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/cipherpay-web/` — Vite web frontend. The website screens live in `src/`, with the main shell in `src/App.tsx` and page-level features in `src/pages/`.
- `artifacts/api-server/` — Express 5 API. Routes in `src/routes/`, provider clients in `src/lib/` (socially, paystack, email). `jap` and `smsactivate` are legacy/unused.
- `lib/db/` — Drizzle schema + Postgres (source of truth for DB).

## Architecture decisions

- Theme defaults to light. Palette = coral-orange CTA/accent (`primary`/`accent`/`tint` ≈ `#f4733a`) + purple brand gradients (hero/wallet cards & brand icon tiles keep purple `#8b5cf6`/`#7c3aed`) + white cards, matching the reference quiz-app design. Dark mode is a persisted toggle. Interactive color comes from `useColors()` tokens (`primary` is orange), so buttons/active-tab/links re-skin centrally via `constants/colors.ts`; purple gradient arrays are hardcoded per-screen (hero/wallet cards, auth brand icon boxes) and auth CTA buttons are hardcoded `#f4733a`.
- All user prompts go through `useUI()` (toast/confirm) — `Alert.alert` is banned.
- P2P transfers (`/wallet/transfer/p2p`) are instant by unique 10-digit account number with a tiered fee; withdrawals are external bank and **fully automated via Flutterwave Transfers**: at request time the wallet is debited (amount + tiered fee), the tx is set `pending`, and a Flutterwave transfer fires immediately. The `transfer.completed` webhook (`/api/webhooks/flutterwave`, verified by `FLW_SECRET_HASH`) finalizes the tx to `success` on `SUCCESSFUL` or refunds the full debit on `FAILED`. An outright provider rejection at request time also auto-refunds. Admin console treats automatic payouts as read-only (with a manual Flutterwave status reconcile). No OTP. Optional client-side biometric 2FA gates the submit when the user enables it.
- Login OTP is enabled through `ENABLE_LOGIN_OTP=true`: verified users must complete the emailed second-factor flow through `/auth/verify-login-otp`. New accounts receive an email verification OTP, and password resets use an emailed reset OTP.
- Funding (Fund screen) offers a 2-way method selector (Bank transfer / Card) defaulting to **bank transfer**. Bank transfer mints a temporary Flutterwave NUBAN (`POST /wallet/fund/bank-transfer` → `initiateBankTransfer`) tied to the entered amount; the user pays into it and the wallet is auto-credited by the `charge.completed` webhook (the client also polls `/wallet/fund/verify`). Card goes to Flutterwave hosted checkout (`/wallet/fund` with `channel=card`), verified by `/wallet/fund/verify` and the `charge.completed` webhook. A legacy manual fixed-account path (`GET /wallet/deposit-account` sourced from `DEPOSIT_BANK_NAME`/`DEPOSIT_ACCOUNT_NUMBER`/`DEPOSIT_ACCOUNT_NAME` env + `POST /wallet/deposit/claim`, admin-confirmed) remains server-side as a fallback but is no longer the mobile default.

## Product

Wallet with greeting/avatar home + 2 recent transactions; fund (bank transfer via an auto-generated Flutterwave NUBAN, or card/USSD via Flutterwave), send (P2P lookup→confirm→fee), withdraw (external bank, automated Flutterwave payout). Transaction history with detail + share. Notifications, device/session management (revoke/revoke-all), profile + avatar editing. VAS: airtime, data, and electricity bills (Flutterwave), social boosts, and SMS verification numbers (socially.ng). SMS verification has an inbox that polls socially.ng for the received OTP. Admin console for users/deposits/withdrawals/KYC/broadcast.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Backend↔mobile share raw strings (transaction `type`, notification `{unread}`); a mismatch compiles but silently breaks filters/badges. Bills tx type is `bill` (singular). See `.agents/memory/transaction-type-contract.md`.
- Wallet funding has two methods: bank transfer (default) and card/USSD. Bank transfer calls Flutterwave `POST /v3/charges?type=bank_transfer` to mint a temporary NUBAN the user pays into; the wallet is credited by the `charge.completed` webhook (and the client polls `/wallet/fund/verify`). The funding details display the fixed labels `Flutterwave FMB` as the bank name and `CipherPay Wallet Funding` as the account name, while the account number remains the temporary Flutterwave account returned for that deposit. Card/USSD continues to use the hosted-checkout link in a WebView. (A legacy manual fixed-account deposit path — `/wallet/deposit-account` + `/wallet/deposit/claim`, admin-confirmed — still exists server-side as a fallback but the mobile app uses the automated NUBAN flow.)
- User-facing Flutterwave errors go through `friendlyFlwError()` in `flutterwave.ts` — raw provider reasons (IP-whitelist, low balance, validation) are logged via `req.log` but never surfaced to users. Fund, bank-transfer, and withdraw routes all return `502` with the friendly message.
- VAS provider keys must be set for those flows to work: `SOCIALLY_API_KEY` (social boosts, SMS verification; `SOCIALLY_BASE_URL` optional), `FLUTTERWAVE_SECRET_KEY` (card/USSD funding, bank-transfer NUBAN charge, automated bank-payout transfers, **airtime, data, electricity**). Data bundles use Flutterwave (`GET /bill-categories?data_bundle=1` for plans catalog — no IP whitelist; `POST /v3/bills` for purchase — IP whitelist required). `FLW_SECRET_HASH` (set) authenticates the Flutterwave webhook at `/api/webhooks/flutterwave` — must match the value configured in the Flutterwave dashboard (Settings → Webhooks) for `charge.completed`/`transfer.completed` to be accepted. Email keys (`EMAIL_PASS`) are configured. NOTE: Flutterwave bill payment AND transfers (`POST /v3/bills`, `POST /v3/transfers`) require the caller's egress IP to be whitelisted in the Flutterwave dashboard — dev and prod egress IPs differ (prod needs a Reserved VM for a stable IP). Until whitelisted, pay/transfer returns HTTP 400 "Please enable IP Whitelisting". Automated payouts also require a funded Flutterwave transfer balance.
- A flat ₦50 profit margin (`VAS_PROFIT_FEE` in services.ts) is added to data plans (baked into the `/data/plans` price, so debit + refund all use the marked-up price) and to airtime (server charges `amount + 50`; the airtime screen shows a "Service fee" line and total). Other socially.ng prices (SMS, social boosts) remain pass-through. SMS verification uses a single default provider; `/sms/buy-number` re-fetches the live price server-side before debiting. If an SMS activation is cancelled/expired without an OTP, `/sms/check-sms/:reference` refunds the original debit via the idempotent `refundFailed` CAS.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
