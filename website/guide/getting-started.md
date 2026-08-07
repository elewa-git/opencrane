# Install OpenCrane

OpenCrane is **plain Kubernetes**. If you can run a Kubernetes cluster, you can run
OpenCrane — there's no special cloud dependency. Pick the path that fits you:

| Path | Best for | Guide |
|------|----------|-------|
| **Local, VM or VPS** | Trying it out, a demo, or a small team on a single machine | [Local, VM or VPS →](/guide/deploy-local) |
| **Cluster** | Production, scale, high availability | [Cluster deployment →](/guide/deploy-cluster) |

Both install the same way — the only difference is the size and shape of the
Kubernetes underneath.

## Connect to the management API

Operators sign in through OIDC and use the resulting session with the management API.
There is no static API token to copy into a terminal. The current UI does not expose every
management surface, so use an authenticated client and retrieve its contract through the
[API reference](/reference/api).

For TypeScript integrations, use the generated client described in the
[Contracts SDK](/integrators/contracts-sdk).

## Then

1. **[Set up your domain](/guide/dns)** — point DNS at OpenCrane and turn on HTTPS.
2. **[Set up your personal assistant](/guide/persona)** — the interview every person completes
   before their assistant can run.
3. **[Create a managed agent](/guide/first-agent)** for shared, scheduled or triggered work, once
   you're ready to go beyond your own assistant.
