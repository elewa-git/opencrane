# DNS configuration

Give each OpenCrane silo a **stable organisation host** that routes its UI and public API
through the cluster Ingress.

> See also: [Set up your domain](/guide/dns) (admin steps),
> [Hosting and deployment](/operators/hosting) (release shape), and
> [Networking and isolation](/operators/networking) (public and internal surfaces).

## Host model

For base domain `opencrane.example.com` and organisation `acme`, use a host such as:

```text
acme.opencrane.example.com
```

The host identifies the `ClusterTenant` silo. It does not route to an individual runtime:
runtime Jobs have no public DNS name, Service or Ingress.

## Required records

| Record | Target | Ownership |
|---|---|---|
| Organisation host | Cluster ingress address | DNS operator |
| Optional wildcard | Cluster ingress address | DNS operator |
| ACME challenge records | DNS provider | cert-manager solver |

Use a wildcard only when your deployment policy deliberately serves several organisation hosts
below one base. A single-silo installation can use an explicit A, AAAA or CNAME record.

## TLS

Configure the organisation host on the Ingress and issue a certificate whose subject
alternative names include that exact host. A wildcard certificate may cover sibling
organisation hosts, but does not change their application-level isolation.

::: warning
DNS and TLS establish where a request arrives. They do not establish which organisation,
subject or run it may access; OpenCrane still resolves and checks that authority.
:::

## Verification

```bash
dig +short acme.opencrane.example.com
kubectl get ingress,certificate -n <server-namespace>
```

Then verify the certificate chain and that `/api/v1/openapi.json` is served by the expected
silo. Internal `/api/internal` routes must not be exposed by the Ingress.

Source: [`apps/opencrane/helm/templates/_ingress.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/helm/templates/_ingress.tpl)
and [`apps/opencrane/helm/templates/_certificate.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/helm/templates/_certificate.tpl).
