# @opencrane/state/assets/adapter — personal asset gateway

This state-only package exposes the signed-in user's browser-safe asset catalogue through a swappable Angular gateway. It has no UI and cannot read bytes, upload, delete, or mutate assets.

`OpenCranePersonalAssetsGateway` calls `/me/assets` through the cookie-session Control Plane client. The server derives owner and silo; this package never sends either coordinate.
