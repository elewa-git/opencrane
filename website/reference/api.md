# API reference

OpenCrane serves its **authoritative OpenAPI 3.1 document at runtime**. Generate and
validate clients against the deployed instance you intend to integrate with.

## Endpoint

```text
GET /api/v1/openapi.json
```

The document is emitted from the routers composed by that OpenCrane server. This docs site
does not bundle a second copy that could drift from the deployed contract.

## Use the contract

1. Download `/api/v1/openapi.json` from the target instance.
2. Review its server URL and authentication requirements.
3. Generate or update your client.
4. Run a contract test against that instance before deployment.

For authentication and internal trust-boundary context, see the
[API overview](/reference/api-overview). For the maintained TypeScript package, see the
[Contracts SDK](/integrators/contracts-sdk).
