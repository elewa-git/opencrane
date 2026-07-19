# @opencrane/backend/channel-proxy — Channel proxy

Owns target-neutral forwarding for browser channel traffic. For every command or event request it
asks OpenCrane for an authorized destination, forwards only to that result, and applies origin,
identity-header, size, timeout, and per-subject rate limits.

This library is not a policy authority and does not choose agent endpoints itself. The corresponding
control-plane decision lives in [`server/channel-targets`](../../server/channel-targets/main/).
Its public surface is `src/index.ts`.
