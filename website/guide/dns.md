# Set up your domain

Every organisation gets its own web address — `acme.opencrane.example.com`,
`globex.opencrane.example.com`, and so on. All employees in an org use that single address.
To make that work (with HTTPS), you point a domain at OpenCrane and let it handle
certificates.

You do this once.

## 1. Delegate your domain to OpenCrane's DNS zone

When OpenCrane manages your DNS (the default on GKE, via a Cloud DNS zone Terraform
provisions), you do this **once** at your registrar: point your domain's **name servers**
at the zone OpenCrane created — an **NS delegation**. After that, OpenCrane writes the
records for you; you never touch individual records again.

```
# At your registrar, set the domain's NS records to the zone name servers
# (Terraform prints them as the `dns_name_servers` output).
opencrane.example.com.   NS   ns-cloud-a1.googledomains.com.
opencrane.example.com.   NS   ns-cloud-a2.googledomains.com.   # …etc
```

The install-time records (the opencrane-api host, the apex, and the platform wildcard
`*.opencrane.example.com` that lets every assistant appear at its own address instantly)
are created in that zone for you. **Per-org records are written automatically at runtime**
by the in-cluster **external-dns** controller, from the declarations OpenCrane's operator
emits — so a new org's address resolves with zero manual DNS work.

Not delegating? You can instead point an apex A record and a wildcard `*.<domain>` A
record straight at the ingress IP at your own provider — but then per-org records and
automatic HTTPS are your responsibility.

## 2. Turn on automatic HTTPS

OpenCrane issues a wildcard TLS certificate for you using Let's Encrypt. Because the
certificate is a wildcard, it's validated through your DNS provider — so OpenCrane
needs permission to create a temporary verification record. Configure it through the
authenticated Fleet Manager API:

```bash
curl --fail-with-body \
  --request PUT "$OPENCRANE_FLEET_URL/api/v1/platform/dns" \
  --header "Authorization: Bearer $OPENCRANE_TOKEN" \
  --header "Content-Type: application/json" \
  --data @dns-configuration.json
```

The JSON body selects the provider and zone, gives Let's Encrypt a renewal email, and
includes a provider token scoped to edit that zone. Build it from a protected file so
the token does not land in shell history, and delete the request file afterwards.
Certificates renew automatically;
check the active issuer with authenticated `GET /api/v1/platform/dns`. The full schema
is in [DNS configuration](/operators/dns-config#api-surface).

::: tip Just testing locally?
On a laptop install you can skip all of this — local mode doesn't need real DNS or
public certificates.
:::

## Next

Your domain is ready. → **[Create your first employee assistant](/guide/first-tenant)**
