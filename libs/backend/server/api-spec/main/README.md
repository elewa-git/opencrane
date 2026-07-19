# @opencrane/backend/server/api-spec — API specification

Owns the assembled OpenAPI contract for the OpenCrane server. It brings each server capability's
public paths into one specification from which the published API description and client contracts
are generated.

The public surface is `src/index.ts`. When a capability changes its HTTP contract, update its
contribution here and regenerate the API outputs through the server's documented contract tasks.
See [`../../README.md`](../../README.md) for the control-plane map.
