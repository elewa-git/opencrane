# Contracts SDK

`@opencrane/contracts` is the **public SDK and API contract** for the OpenCrane
control plane: a typed TypeScript client (`openapi-fetch`) plus DTOs generated
from the OpenCrane OpenAPI 3.1 specification emitted during the build.

It is the contract used by the OpenCrane UI and the recommended way for any external
surface to talk to OpenCrane.

## Licensing — MIT, deliberately

The platform is AGPL-3.0-or-later, but **`@opencrane/contracts` is MIT**. This is
an intentional relicensing by the copyright owner so external consumers —
**including proprietary frontends** — can use the generated client and types
without inheriting AGPL obligations. The MIT grant covers only the
`libs/contracts/` directory.

## Consuming the contract externally

You don't need to import the package to build a client. The control plane
publishes its OpenAPI spec two ways:

- **At runtime:** `GET /api/v1/openapi.json`
- **As a release asset** named `openapi.json` on each tagged release.

External frontends should **pin a released `openapi.json`** and generate their own
client. This keeps a clean process/network boundary and links against no AGPL
code:

```bash
# Pin a specific OpenCrane release, then generate a typed client locally.
curl -fsSL -o openapi/opencrane.json \
  https://github.com/elewa-git/opencrane/releases/download/<tag>/openapi.json
npx openapi-typescript openapi/opencrane.json -o src/api/generated.ts
```

## The spec is the source of truth

The OpenAPI spec is emitted at build time and guarded by a **CI drift gate**, so the
SDK and the [interactive API reference](/reference/api) on this site never drift from
the implementation.

## Related

- [API reference (interactive)](/reference/api)
- [API overview](/reference/api-overview)
- Full package README:
  [`libs/contracts/README.md`](https://github.com/elewa-git/opencrane/blob/main/libs/contracts/README.md)
