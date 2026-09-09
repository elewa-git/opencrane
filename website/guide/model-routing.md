# Model routing

Instead of wiring each agent to one hard-coded model, register the models your organisation is
allowed to use, and let OpenCrane resolve which one a given run actually calls. Every model call
goes through **LiteLLM**, a self-hosted proxy that fronts your chosen providers, so a raw provider
API key never reaches a runtime container. In the server model-step path, the server also
keeps the short-lived LiteLLM key; conversation Pods request work by turn id and receive status.

## Register models

Use the authenticated `/api/v1/models` surface to list and manage model definitions.
Definitions refer to provider credentials held by OpenCrane; raw provider keys do not enter
conversation-computer Pods.

## Configure providers after deployment

A fresh OpenCrane silo can be ready without an upstream model key. An organisation administrator
configures a supported provider through `/api/v1/providers/byok/{provider}` after signing in. The
raw key is write-only: status reads reveal whether it is configured, never the key itself.

```text
authenticated administrator
        │ central Organization/Administer decision
        ▼
ProviderEffectCommand commits with non-secret intent and decision evidence
        │ after commit
        ├── store raw key in the fixed Kubernetes Secret
        ├── reconcile the LiteLLM credential and exact deployments
        └── finalise ProviderCredential and ModelDefinition projections
```

Setting or deleting a BYOK key and registering a model are durable provider effects. A command can
be resumed after an interrupted request, and the background reconciler can continue work that needs
no raw key. A replacement command cannot bypass an earlier uncertain effect on the same resource.

::: warning
Deployment does not bootstrap a provider or model. A model-unconfigured control plane can serve
administration and health requests, but an agent run that needs a model remains unavailable until an
administrator completes provider and model configuration.
:::

## Set defaults

`/api/v1/model-routing/defaults` lists and updates defaults by scope and `ClusterTenant`.
Global defaults are operator-only. Organisation-scoped defaults require the matching
authorisation boundary.

When OpenCrane admits a run, it resolves the model route and records it in the
`RunInputSnapshot`. The server reserves each model request within that run's original allowance.
The prompt and attempt-scoped LiteLLM key stay server-side, and a saved answer can be completed
after restart without another model request.

The continuation implementation may let the first request select one frozen tool requiring no approval,
then use its verified result for a second request that accepts text only. Both use the same key,
allowed alias, original spend limit and actual expiry. The first token reservation is fully deducted
before the second is made; retries cannot reset the budget or mint a replacement key.

The preceding text checkpoint has passed full CI. The continuation implementation in PR #830
awaits CI and live qualification. Neither replacement is installed on testv5. An unrecoverable
response leaves the run pending for future recovery controls without another paid dispatch.
LiteLLM and provider-internal retries have not been qualified as exactly-once execution.
See [development status](/guide/status).

::: tip
Changing a default affects future admissions. It does not change the model route frozen into
an existing run.
:::

::: info
Automated evaluation cases, savings measurements and approval proposals are not mounted in
the current server composition.
:::

Source: [`providers`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/gateways/providers/main/README.md)
and [`ProviderEffectCommand`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/providers.prisma).

## See also

- [Manage cost](/guide/budgets)
- [Review activity](/guide/audit)
- [Central authorization authority](/integrators/authorization-authority)
- [Governed packages and container images](/integrators/governed-packages)
- [Telemetry and logging](/operators/telemetry-logging)
- [API reference](/reference/api)
