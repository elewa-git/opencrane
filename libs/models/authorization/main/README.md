# @opencrane/models/authorization — one product permission vocabulary

> [models](../../README.md) › authorization

## What it owns

This model package defines OpenCrane's shared **authorization** vocabulary and its pure, deterministic
allow-or-deny function. It gives every product domain the same typed resource kinds, actions,
capability catalogue, grant shape, boundary rules, and evidence classes without importing a database
or server framework.

The product catalogue distinguishes stable resources such as an agent, skill, or MCP server from
their immutable revisions. It also distinguishes an `McpTask`, which may wait for required input,
from the `ToolInvocation` created only after the effect arguments are complete. Each supported
`resource kind × action` pair declares one evidence class:

| Evidence class | Meaning |
|---|---|
| `Read` | A short transaction may filter or return data without appending one record per visible item. |
| `Decision` | The protected database change and its authorization evidence must commit together. |
| `Effect` | The transaction creates a one-use admitted command before an external worker performs the effect. |

```
 product domain supplies a typed resource, action, boundary and Principal
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │ models/authorization  ◄── HERE                          │
 │ catalogue rule → matching grants → allow or deny        │
 └─────────────────────────────────────────────────────────┘
                              │
                              ▼
       evidence requirement returned with the decision
```

**In this flow:** the [server authorization authority](../../../backend/server/iam/authorization/main/README.md)
loads current membership, grants, and boundary facts before calling these pure rules.

`__DecideAuthorization` is fail-closed. It rejects malformed grants, drops future, expired, or
revoked grants, selects the highest-priority matches, and lets deny win a tie. A Group grant applies
only through stored membership and boundary facts; resource identifiers never imply hierarchy.
The server authority may additionally require `Descendants` coverage for a subtree assignment; that
requirement is part of the typed command and decision digest, not an informal caller-side check.

## Public surface

- `ProductAuthorizationResourceKinds`, `ProductAuthorizationActions`, and
  `ProductAuthorizationEvidenceKinds` name the reviewed product policy vocabulary.
- `PRODUCT_AUTHORIZATION_RULES`, its immutable catalogue coordinates, and
  `__ProductAuthorizationCapability` bind a resource action to one capability and evidence class.
- `__DecideAuthorization`, `AuthorizationRequest`, `AuthorizationGrant`, and
  `AuthorizationDecision` implement the deterministic grant decision.
- `AuthorizationBoundary`, `AuthorizationSubject`, `AuthorizationResourceLocator`, and their
  matching helpers keep subjects, resources, and exact Personal or Group boundaries explicit.
- Fleet-membership types and `Es256PublicJwk` describe independently verified identity evidence
  consumed at server enforcement points; they do not perform cryptography or I/O here. The retired
  DPoP capability verifier and its separate action-receipt model are not part of this package.

## Boundary

This package owns policy vocabulary and pure evaluation only. It does not load membership, expand
Groups, open a database transaction, write audit evidence, execute an external action, or decide
whether a domain resource is in a usable lifecycle state. Callers must supply trusted current time
and verified facts; missing or unsupported inputs deny.

## Dependency direction

Tagged `scope:authorization` (`layer:model`): it may depend only on `scope:authorization`,
`scope:audit`, and `scope:shared` packages — never on apps, backend domains, or infrastructure.

## See also

- Parent index: [models](../../README.md)
- Runtime owner: [server authorization](../../../backend/server/iam/authorization/main/README.md)
- Siblings: [agents](../../agents/main/README.md) · [artifacts](../../artifacts/main/README.md)
