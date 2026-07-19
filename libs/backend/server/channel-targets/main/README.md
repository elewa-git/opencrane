# @opencrane/backend/server/channel-targets — Channel targets

Owns the control-plane decision behind a browser channel operation. It verifies the calling
workload and browser identity, checks current membership and required actions, then issues a
short-lived target context for the selected thread or declines the request.

The public surface is `src/index.ts`; the router composes the HTTP boundary and
`PrismaChannelTargetAuthorityRepository` provides durable target authority. See
[`../../README.md`](../../README.md) for the control-plane map.
