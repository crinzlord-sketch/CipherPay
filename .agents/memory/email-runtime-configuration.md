---
name: Email runtime configuration
description: Email delivery depends on SMTP credentials being present in the API process, not just saved in the workspace.
---

The API should verify its mail transport during startup and log a safe success or failure message. Authentication and admin-alert mail cannot work when `EMAIL_USER` or `EMAIL_PASS` is absent or empty in the running API environment, even if the secret names exist and the email code itself is correct.

**Why:** A missing runtime secret previously caused OTP and notification delivery to be skipped without an obvious startup signal.

**How to apply:** When email delivery is reported broken, check the API startup verification first and restart the API after refreshing secrets. Secret existence alone is not proof that a usable value is present. Use the secure secrets flow for the SMTP username and app password; never place credentials in code or plain workspace configuration. Inbox placement also requires SPF, DKIM, and DMARC for the sending domain; HTML changes alone cannot guarantee delivery outside spam.

Email Pro account SMTP credentials are encrypted and stored with the user’s account record, so logout/login must not remove them. A failed connection test should clear only the verified state, not delete the saved credential.

**Why:** Users need to test a saved mailbox again after a new session without re-entering credentials, while invalid configurations must not remain eligible for sending.

**How to apply:** Keep password material server-side and omit it from account DTOs. On test failure, mark the account unverified and report the invalid configuration clearly in the UI.