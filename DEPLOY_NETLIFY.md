# CipherPay deployment

CipherPay is deployed as two services:

- **Netlify** serves the Vite website from `artifacts/cipherpay-web/dist/public`.
- **A persistent Node host** runs `artifacts/api-server` because the API has webhooks, scheduled jobs, stable-egress payment calls, and database-backed sessions.

Netlify should not run the Express API as a static site or short-lived function.

## 1. Deploy the API first

Use a persistent Node host such as Render, Railway, Fly.io, or a reserved VM. Configure:

```text
Build: pnpm --filter @workspace/api-server run build
Start: node --enable-source-maps artifacts/api-server/dist/index.mjs
Health check: /api/healthz
Port: use the host-provided PORT
```

Set these API environment variables in the host's secret/environment settings:

```text
DATABASE_URL
SESSION_SECRET
ADMIN_PASSWORD
EMAIL_USER
EMAIL_PASS
FLUTTERWAVE_SECRET_KEY
FLW_SECRET_HASH
FIXIE_URL
SMSPOOL_API_KEY
SOCIALLY_API_KEY
NOWPAYMENTS_API_KEY
NOWPAYMENTS_IPN_SECRET
```

Set these non-secret values:

```text
ADMIN_EMAIL
ADMIN_ALERT_EMAIL
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_FROM
SUPPORT_REPLY_TO
SUPPORT_INBOX_EMAIL
ENABLE_LOGIN_OTP=true
PUBLIC_API_URL=https://api.example.com
PUBLIC_WEB_URL=https://www.example.com
```

`PUBLIC_API_URL` must be the public HTTPS origin of the API with no trailing
slash. `PUBLIC_WEB_URL` must be the public HTTPS origin of the Netlify site
with no trailing slash. Configure the Flutterwave webhook as:

```text
https://api.example.com/api/webhooks/flutterwave
```

Configure the NowPayments IPN callback as:

```text
https://api.example.com/api/webhooks/nowpayments
```

Flutterwave bill payments and automated transfers require the API host's stable
egress IP to be whitelisted. Keep `FIXIE_URL` or use a host with a reserved
outbound IP.

## 2. Deploy the website to Netlify

Create a Netlify site connected to this repository and use:

```text
Base directory: /
Build command: pnpm --filter @workspace/cipherpay-web run build
Publish directory: artifacts/cipherpay-web/dist/public
```

Add this site environment variable in Netlify:

```text
VITE_API_URL=https://api.example.com
```

The committed `netlify.toml` already contains the build and SPA fallback
configuration. Redeploy after setting `VITE_API_URL`.

## 3. Final checks

1. Open `https://api.example.com/api/healthz` and confirm `{"status":"ok"}`.
2. Register a new website account and confirm the email verification OTP arrives.
3. Sign in again and confirm the login OTP is required and arrives by email.
4. Test password reset with a real mailbox.
5. Test Flutterwave funding in the provider dashboard's live mode.
6. Test one low-value VAS transaction only after live credentials and webhook
   signatures are configured.
7. Confirm `/api/webhooks/flutterwave` and `/api/webhooks/nowpayments` receive
   callbacks from their providers.
