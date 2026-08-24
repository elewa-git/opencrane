# @opencrane/models/local-development — Tier 2 profile vocabulary

> [models](../../README.md) › local development

This pure model package names the development-only application profiles and the fixed local human
identity shape shared by their coordinator and process entrypoints. The values select composition;
they do not authenticate a caller or grant product authority.

## What it owns

- The stable `core`, `agent-local`, `agent-remote`, and `agent-simulated` profile names.
- The fixed local human identity and signed-membership identifiers shared by the seed and server.
- The JSON contract that keeps TypeScript, JavaScript, and Python process values aligned in tests.
- The runtime namespace and ServiceAccount coordinates shared by local token issuers and reviewers.

Production entrypoints must not import this package. Tier 1 also remains independent: it owns an
in-memory browser profile, while these values select the real API and PostgreSQL Tier 2 workflow.

## Public surface

Import `LocalDevelopmentProfileKinds`, `LocalDevelopmentIdentity`,
`LOCAL_DEVELOPMENT_RUNTIME_IDENTITIES`, and `__IsLocalDevelopmentProfileKind` from
`@opencrane/models/local-development`. The same barrel exports the fixed local identity plus the
membership issuer, key, and personal assertion identifiers used by the app-owned seed and verifier.

## Boundary

This package is pure vocabulary. It owns no process launch, database writes, authentication, model
traffic, or production fallback.

## Dependency direction

As a `layer:model` package it imports no backend, frontend, infrastructure, or application package.

## See also

- Parent index: [models](../../README.md)
- Server entrypoint: [opencrane](../../../../apps/opencrane/README.md)
- Browser entrypoint: [opencrane-ui](../../../../apps/opencrane-ui/README.md)
