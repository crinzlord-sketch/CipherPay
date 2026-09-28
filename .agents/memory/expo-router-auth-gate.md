---
name: expo-router AuthGate redirect pattern
description: Why returning <Redirect> in place of the navigator breaks navigation
---

In `app/_layout.tsx`, AuthGate must **always render the `<Stack>` navigator** and perform auth redirects inside a `useEffect` (via `useRouter().replace`). Do NOT conditionally `return <Redirect/>` (or `null`) in place of the navigator once past initial load.

**Why:** Returning `<Redirect>` unmounts the entire `<Stack>`. If a screen also calls `router.replace(...)` imperatively at the same moment (e.g. after login), the two race and you get "action 'REPLACE' … was not handled by any navigator" plus a redirect loop back to login.

**How to apply:** Centralize ALL auth-driven navigation in AuthGate's effect. Remove imperative `router.replace` to verify-email/home from login/register/verify-email screens — just set user state and let AuthGate react. Screen-local pushes that don't depend on user state (forgot→reset, reset→login, back buttons) are fine.
