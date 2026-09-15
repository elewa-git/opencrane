# conversation-computer — leased computer process boundary

> [apps](../README.md) › conversation-computer

## What it owns

This app is the process entrypoint for one 0.11 conversation computer. In production, Kubernetes
Agent Sandbox starts its image from a release-owned profile after OpenCrane admits a
generation-bound computer lease. Tier 2 starts the Python module directly from the local checkout.

```text
 KurrentDB lease event
          │
          ├── production ──► SandboxClaim/Pod ──► conversation-computer ◄── HERE
          │                                              ├── Pod-bound bootstrap
          │                                              ├── server model-step request
          │                                              ├── turn outcome polling
          │                                              └── lease-local review gateway
          │
          └── Tier 2 ──────► host child/private bearer ──► conversation-computer
                                                         ├── host-bound bootstrap
                                                         ├── server model-step request
                                                         └── turn outcome polling
```

**In this flow:** [opencrane](../opencrane/README.md) admits the lease, while
[agent-sandbox](../_infra/agent-sandbox/README.md) fixes the production image and confinement profile.
Tier 2 instead uses the local host-process owner composed by the OpenCrane development entrypoint.

The process refuses startup unless it receives an explicit realization kind, computer id, lease id,
computer generation and private server endpoint. Production `agent_sandbox` mode re-reads a
short-lived, audience-bound projected token for every exchange. Host development reads the private
bearer file owned by its parent server process.
After binding the process to the current lease, the server returns a bootstrap id and its outcome. The
process sends exactly `{bootstrapId}` to the private model-step route when that outcome is `ready`.
The server chooses the next step from saved progress. It owns the compiled input, model credential,
original call and token budgets, tool selection, result continuation and conversation output. The process
receives none of those inputs or credentials and has no direct tool-proposal or output route.

Pending work polls bootstrap at the normal two-second cadence. A `response_unavailable` or
`authority_ended` model outcome keeps readiness degraded while the process polls for recovery; it
does not resubmit that bootstrap's model step. Bootstrap also preserves `response_unavailable` after
a process restart. Private HTTP requests allow 30 seconds, covering the server's 25-second model
dispatch deadline. The server may use one permitted tool result for a second, text-only request;
the worker neither chooses that request nor acquires a fresh model allowance. This continuation is
implemented in PR #830 and awaits CI and live qualification. Visible tool progress,
approvals and recovery controls remain separate product work.

## Public surface

Entrypoint: `python3 -m src.main`. In production it serves `/healthz` and `/readyz` on port 8080. A
second listener on private port 8090 accepts one bearer: a review credential the server derives with a server-only key
from the silo, computer, generation and lease id. The process fetches that secret once at start over
the TokenReviewed private API and writes it to a tmpfs file; the listener refuses every request until
the file exists. The lease id itself is a public Pod label and never grants access. The listener
exposes bounded argv-only commands, selected workspace files and diffs, plus GET-only proxying to five
release-allowlisted localhost preview ports. NetworkPolicy admits that port only from this release's
OpenCrane server. The server presents one credential per key still in its keyring, comma-separated
and newest first; the listener accepts the request when any of them equals the secret it holds, so a
keyring rotation during the lease does not lock the server out. Retiring the granting key ends access
until the next lease.
The same authenticated gateway exposes Chromium 142 CDP discovery, creates targets only for those
localhost previews, and renders bounded preview screenshots. Raw CDP remains on Pod loopback port
9222 and is neither a container port nor a public server route.

Tier 2 runs the same Python module from the checkout in `host_development_process` mode without
pretending that the workstation is an Agent Sandbox. The parent server writes a private bearer file,
starts one process fenced to the persisted lease and waits for its process marker. The marker proves
that configuration was accepted; it is not a health or model-readiness claim. That process runs the
bootstrap/model-step loop against a loopback listener. It starts no health listener, review command
gateway, checkpoint restore, browser/CDP surface, Kubernetes claim or projected-token flow. Stopping
the Tier 2 launch revokes the bearer before terminating the child. Host mode also makes no claim
that the workstation enforces the production profile's RuntimeClass, network policy or resource
ceiling.

## Boundary

This app does not implement the retired AgentRun HTTP/server-sent event protocol, warm reservations,
or continuation checkpoints. It does not provide a public execution port, browser/Chrome DevTools
WebSocket, noVNC, CodeProject, Git service, isolated build, artifact publication or published
PreviewApp. The review listener is never directly exposed through public ingress and never turns a
localhost preview into a separately published workload.

## Dependency direction

This is a thin app entrypoint (`type:app`, `scope:conversation-computer`). It imports no other app and
holds no product authorization or lifecycle authority.

## Runtime & config

The image runs as uid/gid 65532 with no writable application files. Both modes require
`OPENCRANE_COMPUTER_REALIZATION_KIND`, `OPENCRANE_COMPUTER_ID`,
`OPENCRANE_COMPUTER_GENERATION`, `OPENCRANE_COMPUTER_LEASE_ID`, and
`OPENCRANE_INTERNAL_ENDPOINT`. Production uses `agent_sandbox`; its projected token defaults to
`/var/run/secrets/opencrane/token`;
the review credential file (`OPENCRANE_REVIEW_CREDENTIAL_PATH`) defaults to
`/var/run/opencrane/review/credential` on a memory-backed volume; `OPENCRANE_COMPUTER_HEALTH_PORT`
defaults to `8080`. Tier 2 uses `host_development_process` plus parent-owned
`OPENCRANE_COMPUTER_PROCESS_ID`, `OPENCRANE_HOST_BEARER_PATH`, and
`OPENCRANE_HOST_READY_PATH`; its endpoint must be loopback HTTP.

The writable `/workspace` volume is capped at 2 GiB and dies with the sandbox. The command gateway
admits only `git`, `node`, `npm`, `npx`, and `python3`, passes argv directly without a shell, uses a
fixed environment, stops after 30 seconds, and truncates combined output at 1 MiB. This list shapes
the interface; it is not a security boundary because these developer tools can execute code. The
gVisor runtime, non-root process, dropped capabilities, resource ceiling, ephemeral workspace and
default-deny network policy provide the confinement boundary. File, diff and preview responses share
the same 1 MiB ceiling. The preview allowlist defaults to ports 3000, 4173, 4200, 5173 and 8000 and
always targets `127.0.0.1`.

## See also

- Parent index: [apps](../README.md)
- Sandbox profile: [agent-sandbox](../_infra/agent-sandbox/README.md)
- Server composition: [opencrane](../opencrane/README.md)
