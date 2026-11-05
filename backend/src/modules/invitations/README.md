# Invitations — E2.4

routes.ts generates secrets, hashes before SQL, bounds redeem JSON and composes the
existing authenticated API. landing.ts is a minimal context-free server page using
memory-only fragment continuation and explicit CSRF-protected POST after Google login
in a separate tab. No E1 state/cookie/callback change. Page-specific nonce CSP permits
only its script and same-origin fetch; API responses retain default-src none.

Private invitations_action uses current session actor through api_call. Project,
Trip and invitation locks precede membership changes. Existing-access consumes once;
no role duplication/downgrade/promotion. Fresh invitations explicitly authorize
rejoining; consumed links cannot undo E2.3 removal. Expiry/issuer/ancestry rechecked.
No plaintext tokens in SQL/audit, no server request logging, no inspection endpoint.
