---
name: Login OTP 2FA
description: Login second-factor flow and the feature flag that controls whether it is active
---

# Login OTP (email 2FA)

The login OTP flow is retained but disabled by default. `ENABLE_LOGIN_OTP=true` restores it;
when unset or any other value, verified users receive a session directly from `/auth/login`.

## Flow contract
- `POST /auth/login` (verified user, including admins): when enabled, does NOT mint a session. It inserts a `login`-purpose OTP, emails it, and returns `{requiresOtp:true,email,otpDelivery}`. When disabled, it returns `{user,token}` directly.
- `POST /auth/verify-login-otp` `{email,code,device}`: validates latest unused non-expired `login` OTP, CAS-claims `used=false -> true` (single-use under races), then `getOrCreateWallet` + `createSession` + `signToken`, returns `{user,token}`.
- **Unverified-email path is unchanged**: `/auth/login` still returns `{token,user,requiresEmailVerification}` so the verify-email screen can run; AuthGate routes there because the user is unverified. Do not "fix" this to also require login OTP.

## Why the password is held in mobile memory when enabled
**Why:** the admin login (`/admin/login`) needs the raw password after OTP verification, but the password step and OTP step are separate requests. AuthContext keeps `pendingLogin` (email+password) in-memory only between the two steps, then clears it. Never persisted to storage.

## Brute-force guard
`/auth/verify-login-otp` uses an in-memory per-email attempt map (5 fails / 15min window → 15min lockout), mirroring the password-reset flow. It is process-local (resets on restart, not shared across instances) — acceptable as defense-in-depth on top of OTP expiry + single-use.

## Resend cooldown
OTP resend actions are limited to one request every 30 seconds across login, email verification, and password reset. Clients show the countdown, while the API enforces the cooldown and returns `retryAfterSeconds` with HTTP 429 when bypassed.
**Why:** Prevents accidental duplicate sends and simple button/API spam while keeping the wait short enough for users who did not receive the first email.

## Codegen note
These routes parse `req.body` manually (like forgot/reset-password) to avoid regenerating api-zod from the OpenAPI spec. The otp `purpose` column is plain `text`, so adding the "login" purpose needed no migration.
