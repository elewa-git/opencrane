# Local, VM or VPS

Run one **OpenCrane organisation silo** on a small Kubernetes cluster. This is suitable
for evaluation and single-node environments where control-plane downtime is acceptable.

## Prerequisites

- Kubernetes 1.30 or newer.
- A default StorageClass.
- An ingress controller if you need browser access.
- A CNI that enforces `NetworkPolicy`.
- PostgreSQL Secrets required by the deployment profile.
- KurrentDB, Agent Sandbox v1beta1 and gVisor prerequisites for the 0.11 conversation path.

## Install the silo

Use the [deployment configuration](/operators/deployment-configuration#use-the-deploy-entrypoint)
for the current command and required first-owner, image and credential inputs. Keep environment
choices in a reviewed values profile. The same app-owned script installs the local instance.

Conversation execution additionally needs the
[history and sandbox profile](/operators/deployment-configuration#conversation-execution-profile).
Those services are disabled in generic chart defaults; installing the web application alone does
not produce a working assistant. The current `testv5` wrapper supplies that profile only after its
specific inputs and prerequisites pass validation.

Point the public host at the ingress address before installing so Let's Encrypt HTTP-01 can issue the
browser-trusted certificate. Add `--verify` when you want an advisory check of pod readiness,
hostname resolution, and the public server/database health endpoint after installation. These checks
report diagnostics without turning a completed installation into a failed release.

::: warning
Single-node does not remove the sandbox boundary. Do not substitute an ordinary Pod runtime for the
required `gvisor` RuntimeClass or expose a conversation computer outside the silo.
:::

## Next

→ [Set up your domain](/guide/dns) → [Set up your personal assistant](/guide/persona)
