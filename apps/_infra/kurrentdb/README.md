# KurrentDB deployment

This app owns the release-local KurrentDB workload used by the 0.11.0 HistoryStore. It is a
private, persistent, TLS-only event ledger: it does not authorize requests, expose a public route,
or replace PostgreSQL as the current authorization authority.

An installer must supply an immutable image digest, a TLS Secret with `tls.crt`, `tls.key`, and
`ca.crt`, and an administrator-password Secret. The application server receives neither this
credential nor an implicit fallback to insecure mode. This chart does not create a service credential
or compose the HistoryStore, so a conversation writer cannot be wired until those boundaries exist.

The chart defaults to disabled and refuses to render without the image digest and required Secrets.
The testv5 deploy path enables it only after those inputs, an approved storage class, Agent Sandbox
CRDs, and admission evidence are present. This prevents testv5 from installing an insecure
single-node substitute.
