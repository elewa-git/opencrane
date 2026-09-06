# conversation-computer — leased computer process boundary

> [apps](../README.md) › conversation-computer

## What it owns

This app is the image boundary for one 0.11 conversation computer. Kubernetes Agent Sandbox starts
the image from a release-owned profile after OpenCrane admits a generation-bound computer lease.

```text
 KurrentDB lease event ──► SandboxClaim ──► conversation-computer ◄── HERE
                                                  │
                                                  ├── Pod-bound bootstrap
                                                  ├── one admitted LiteLLM call
                                                  ├── safe output append
                                                  └── lease-local review gateway
```

**In this flow:** [opencrane](../opencrane/README.md) admits the lease, while
[agent-sandbox](../_infra/agent-sandbox/README.md) fixes the image and confinement profile.

The process refuses readiness unless it receives the computer id, lease id, computer generation and
private server endpoint. It re-reads a short-lived, audience-bound projected token for every exchange.
The server returns immutable compiled input and an attempt-scoped LiteLLM route only after binding the
Pod to the current lease. The process checks that the compiled budget admits its single model call
and sends LiteLLM the lower of the frozen per-response and total-token ceilings. Output returns
through the server-owned conversation writer.

## Public surface

Entrypoint: `python3 -m src.main` serves `/healthz` and `/readyz` on port 8080. A second listener on
private port 8090 accepts one bearer: a review credential the server derives with a server-only key
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

The image runs as uid/gid 65532 with no writable application files. Readiness requires
`OPENCRANE_COMPUTER_ID`, `OPENCRANE_COMPUTER_GENERATION`, `OPENCRANE_COMPUTER_LEASE_ID`, and
`OPENCRANE_INTERNAL_ENDPOINT`. The projected token defaults to `/var/run/secrets/opencrane/token`;
the review credential file (`OPENCRANE_REVIEW_CREDENTIAL_PATH`) defaults to
`/var/run/opencrane/review/credential` on a memory-backed volume; `OPENCRANE_COMPUTER_HEALTH_PORT`
defaults to `8080`.

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
