# Server Helm ownership

The OpenCrane server application owns its Deployment, identity and RBAC, Services, edge ingress and certificate, and ingress NetworkPolicy as named Helm templates under `helm/`. The edge ingress sends exact `/healthz` requests to the public server listener before its SPA catch-all, so deployment verification observes server and database health. The silo umbrella composes these resources with its parent release context.
