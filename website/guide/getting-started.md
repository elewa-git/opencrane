# Get started with OpenCrane

If your company already runs OpenCrane, ask its administrator for the address, sign in and follow
[personal-assistant setup](/guide/persona). The installation steps below are for administrators
and developers.

## Install a development instance

The current 0.11 baseline is **pre-MVP** and uses Kubernetes. A release installation starts from a
fresh database baseline. Review [development status](/guide/status) before deciding which journey
you want to evaluate.

| Environment | Guide |
|---|---|
| A local machine, VM or VPS running Kubernetes | [Local deployment](/guide/deploy-local) |
| An existing Kubernetes cluster | [Cluster deployment](/guide/deploy-cluster) |

The deployment guides cover the actual prerequisites: identity-provider configuration, the first
owner, DNS and certificates, database credentials, storage, and the history and sandbox services
needed for conversation execution. A reachable web server alone does not establish that an
assistant can run.

Use the app-owned deployment entrypoint and a saved environment profile. For development updates
and database changes, follow [the deployment workflow](/contributing/deploying) and
[versioning guidance](/contributing/versions-and-migrations).

## Verify the first experience

After installation, verify sign-in, onboarding, a personal conversation and a real model response.
Then check that the conversation remains available after refresh and that its computer can be
inspected. Record the outcomes separately from installation health.

Shared-agent scheduling, group `@agent` conversations and agent-driven tool work are still product
work; they are not additional setup steps that unlock a complete feature today.

## Use the API

Some administration is available through authenticated APIs before it has a complete interface.
Use the [API reference](/reference/api) for current endpoints and payloads, or the
[Contracts SDK](/integrators/contracts-sdk) for a TypeScript client.

> See also: [Personal-assistant setup](/guide/persona) ·
> [Development status](/guide/status) · [Architecture](/advanced/architecture)
