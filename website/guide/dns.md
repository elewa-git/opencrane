# Set up your domain

Give the OpenCrane **organisation silo** one stable HTTPS host, such as
`acme.opencrane.example.com`.

## Point DNS at the ingress

Create an A, AAAA or CNAME record for the organisation host and point it at the cluster
Ingress address. A wildcard record is optional when one DNS zone deliberately serves several
organisation hosts.

```text
acme.opencrane.example.com  A  <ingress-address>
```

## Issue the certificate

Configure cert-manager or your certificate provider so the Ingress TLS Secret covers the
exact organisation host. Keep DNS-provider credentials in a Kubernetes Secret and scope them
to the required zone.

::: tip
Runtime Jobs do not need DNS records. They initiate connections to the same-silo OpenCrane
Service and have no public Ingress.
:::

## Verify

Check that the host resolves, presents the expected certificate and serves
`/api/v1/openapi.json`. The Ingress must not expose `/api/internal`.

For operator details, see [DNS configuration](/operators/dns-config).

## Next

→ [Create your first agent](/guide/first-agent)
