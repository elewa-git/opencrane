# IAM server capabilities

> [backend](../../README.md) › [server](../README.md) › iam

Identity and access management (IAM) answers who is making a request, what they may do, and which
evidence supports that decision. Each child package owns one bounded part of that process.

| Package | Responsibility |
| --- | --- |
| [`identity`](identity/main/README.md) | Turns OpenID Connect sign-in into verified server identity facts. |
| [`membership`](membership/main/README.md) | Verifies signed Fleet execution-membership revisions. |
| [`organization-members`](organization-members/main/README.md) | Owns the settings member directory and standalone invitation lifecycle, or delegates the entire capability to Fleet billing. |
| [`authorization`](authorization/main/README.md) | Evaluates capability proofs and effective access. |
| [`grants`](grants/main/README.md) | Owns shares and resource-share derivation. |
| [`groups`](groups/main/README.md) | Owns group membership and group-scoped access inputs. |
| [`audit`](audit/main/README.md) | Records immutable decision evidence. |

```
 identity ──verified caller──► organization-members
     │                              │
     └──identity + proof──► authorization ──decision──► product capability
                                  │
                         grants · groups · membership
                                  │
                                  ▼
                                audit
```

Packages in this group may consume another IAM package's public identity or decision contract. They
must not absorb the product behaviour they protect, and browser code never becomes an IAM authority.

## See also

- Parent index: [server capabilities](../README.md)
- Neighbouring groups: [managed-agent capabilities](../agents/README.md) · [server infrastructure](../infra/README.md)
