# Release manifests

One manifest, `releases/<version>.json`, matches the root `package.json` version and describes the
current release. Deployment reads three things from it: the PostgreSQL operand image
(`database.operandImage`), the fresh-install baseline path and digest (`database.baselinePath` and
`database.baselineSha256`), and — in `teardown.sh` — the chart identities of the installed version
being retired.

Pre-1.0 there are no upgrade contracts: the current manifest is not immutable, no new manifest is
required per change, and a schema change simply updates `database.baselineSha256` in place after
editing the target baseline. Historical manifests are kept only so `teardown.sh` can retire silos
installed from them; they can go once those silos are rebuilt.

`npm run check:release-versioning` verifies the current manifest exists, passes the schema, binds
the root version, that the baseline file matches its recorded digest, and that the operand tag
major matches the PostgreSQL chart's `externalAppVersion`. The full pre-1.0 policy lives in
[`docs/agents/versioning.md`](../docs/agents/versioning.md).
