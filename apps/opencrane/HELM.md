# Server Helm ownership

The OpenCrane server application owns its Deployment, identity and RBAC, Services, edge ingress and certificate, and ingress NetworkPolicy as named Helm templates under `helm/`. The silo umbrella composes these resources with its parent release context.

## External-action transport env

The server executes an agent's granted tool call through outbound transports whose endpoints are
derived from chart state, never hand-set:

| Env var | Source | Rendered when |
| --- | --- | --- |
| `OBOT_MCP_GATEWAY_URL` | `opencrane.mcpGatewayUrl` helper | `mcpGateway.enabled`, or `sharedPlatform.mcpGateway.mode=shared` |
| `MEMORY_GATEWAY_URL` | Release-local `memory-gateway` Service | Always rendered for the private Cognee design |
| `MEMORY_GATEWAY_TOKEN_FILE` | Projected `opencrane-memory-gateway` ServiceAccount token | Always rendered; never a Cognee credential |
| `EXTERNAL_ACTION_HTTP_TIMEOUT_SECONDS` | `externalActions.httpTimeoutSeconds` (1–300, default 30) | always |

**An unrendered URL is a deliberate fail-closed signal**, not an oversight: the server keeps its
stub for that transport and refuses those tool calls rather than fabricating a result. Removing the
condition would silently change that behaviour.

The server gets no Cognee endpoint or credentials. Its projected token is accepted only by the
release-local memory gateway, which TokenReviews the exact server ServiceAccount before it makes the
private Cognee call. **TODO:** authenticated BYO/non-private Cognee is not implemented; a render with
`clustertenantManager.cognee.install: false` fails closed.
