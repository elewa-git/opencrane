# managed-agent-runtime — image provenance

This app is **chart/deploy-only**. It ships no application source and builds no image of its own.

Managed (central) agent runtime Pods run the **same image as the personal runtime**, built by
[`apps/agent-runtime`](../../agent-runtime/deploy/Dockerfile) — one shared build artifact, never a
duplicated Python source tree. The two planes differ only in their Kubernetes identity and network
reach, projected by the launcher's selectable identity profile (`managed`) and by the namespace,
ServiceAccount, and NetworkPolicies this chart owns.

To pin the image, set the managed-runtime workload profile's `image.digest` to the exact digest CI
published for `apps/agent-runtime`; there is no separate managed-runtime image to build or promote.
