# IAM server capabilities

IAM answers who may do what and records the evidence for those decisions.

- `identity` turns OIDC sign-in into verified server facts.
- `membership` verifies signed fleet membership.
- `authorization` verifies capability proofs and effective access.
- `policies` owns AccessPolicy behaviour.
- `grants` owns shares and resource-share derivation.
- `groups` owns group membership.
- `access-tokens` owns access-token issuance and use.
- `audit` records immutable decision evidence.

Other groups may depend on an IAM public contract for verified identity or a decision. IAM does
not absorb their domain behaviour.
