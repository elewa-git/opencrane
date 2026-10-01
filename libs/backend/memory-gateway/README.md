# Memory gateway

> [backend](../README.md) › memory-gateway

This group owns the private memory gateway's provider connection. Cognee stores remembered text;
the OpenCrane server decides whose memory an operation may access.

| Package | Responsibility |
| --- | --- |
| [main](./main/README.md) | Provider authentication, protocol translation and private request handling. |

```text
apps/memory-gateway
        │ will compose
        ▼
      main ── authenticated requests ──► Cognee
```

Libraries here may use shared contracts, logging and workload identity. They do not import the
server's personal-memory domain or own saved operations, consent or dataset selection.

## See also

- Parent: [backend](../README.md)
- Deployable: [memory gateway](../../../apps/memory-gateway/README.md)
- Server transport: [memory gateway client](../server/infra/memory-gateway-client/README.md)
