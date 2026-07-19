# OpenCrane server control-plane capabilities

This namespace owns capabilities the OpenCrane server uses to administer the product and safely
connect it to deployed agent runtimes. It does not own an employee's personal-agent state; that
lives in [`../agents/personal/`](../agents/personal/).

The newer Phase D authorities are deliberately separate:

- `authorization/` evaluates effective access and proof-bound actions.
- `membership/` verifies current signed fleet membership.
- `agent-services/` publishes immutable agent revisions.
- `artifacts/` finalizes promoted artifact metadata.
- `channel-targets/` authorizes a browser channel operation and resolves its target.
- `identity/` establishes browser identity and turns verified sign-in claims into server facts.
- `api-spec/` assembles the public HTTP contract from the server capabilities.

Other packages retain established server capabilities such as tenant lifecycle, integrations,
knowledge, policies, reporting, and API composition. See [`../README.md`](../README.md) for the
backend-wide ownership and dependency rules.
