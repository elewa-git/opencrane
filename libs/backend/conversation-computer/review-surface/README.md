# backend-conversation-computer-review-surface — private computer review

> [backend](../../README.md) › [conversation computer](../README.md) › review surface

## What it owns

This library owns the sandbox-local human review boundary for a conversation computer. It confines file and Git inspection to the mounted workspace, admits a fixed command set, proxies only release-approved localhost preview ports, and keeps Chromium DevTools on loopback.

The `conversation-computer` app starts this library beside its turn loop. Product authorization and public proxying remain in the server conversations package; this library trusts only the current lease credential injected into its sandbox.

## Public surface

The `review_surface` Python package exposes the authenticated HTTP review service used by the
conversation-computer app.

## Boundary

The library reads only the mounted workspace and fixed local browser or response endpoints. It does
not decide product authorization, accept cluster coordinates, or expose the lease credential.

## Dependency direction

Tagged `scope:conversation-computer`: it remains inside the backend computer boundary and does not
depend on the public server application.

Run `npx nx test backend-conversation-computer-review-surface` to verify authentication, path confinement, command admission, preview routing, and browser restrictions.

## See also

- Parent: [conversation computer](../README.md)
- App: [conversation-computer](../../../../apps/conversation-computer/README.md)
