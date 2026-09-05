# Conversation computer review surface

This library owns the sandbox-local human review boundary for a conversation computer. It confines file and Git inspection to the mounted workspace, admits a fixed command set, proxies only release-approved localhost preview ports, and keeps Chromium DevTools on loopback.

The `conversation-computer` app starts this library beside its turn loop. Product authorization and public proxying remain in the server conversations package; this library trusts only the current lease credential injected into its sandbox.

Run `npx nx test backend-conversation-computer-review-surface` to verify authentication, path confinement, command admission, preview routing, and browser restrictions.
