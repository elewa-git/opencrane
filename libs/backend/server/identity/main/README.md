# @opencrane/backend/server/identity — Identity

Owns the server's browser identity workflows: OpenID Connect login and logout, session status,
and the server-side facts derived after a verified sign-in. It can adopt a member into the
appropriate workspace and mirror identity-provider group claims without making the browser a
source of authority.

The public surface is `src/index.ts`; the auth router is composed by the OpenCrane server. See
[`../../README.md`](../../README.md) for the control-plane map.
