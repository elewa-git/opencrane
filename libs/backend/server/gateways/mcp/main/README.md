# @opencrane/backend/server/gateways/mcp — MCP governance

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

## What it owns

MCP (the Model Context Protocol) is an open standard for connecting an agent to external tools and
data sources. An *MCP server* provides those tools. This package decides which MCP servers exist and
which ones administrators approve. The central authorization authority decides who may discover and
install them.

A workflow is a background job whose progress is saved in the database. If OpenCrane restarts, the
job can continue instead of starting over. Absurd runs these jobs. This package uses workflows to
check a newly registered MCP server and a submitted OCI Image Layout ZIP.

```
 administrator sends POST /mcp/servers
        │
        ▼
 database transaction
   ├── save the draft MCP server
   └── save an Absurd background job
        │
        ▼
 worker checks the server's MCP protocol version
   ├── supported version ──► ready for administrator review
   ├── temporary failure ───► Absurd tries again later
   └── other or bad reply ──► rejected
```

```
 administrator sends POST /mcp/oci-image-validations
        │
        ▼
 database transaction
   ├── save the exact published OCI image revision
   └── save an Absurd background job
        │
        ▼
 worker validates the OCI layout, descriptors, and content digests
   ├── invalid archive or layout ────► rejected
   └── valid immutable OCI layout
            │
            ▼
       copy config, layers, and manifest to the operator registry
            │
            ▼
       save registry/repository@sha256:... ──► imported and stored as immutable evidence for a later governed runtime claim
```

Layout validation checks the OCI Image Layout structure and every content-addressed descriptor. A
successful admission also copies the exact image into the operator registry. Only after every
configuration and layer blob, then the manifest, has been copied and checked at its SHA-256 digest
does it save `registry/repository@sha256:...`. That value is immutable evidence of the imported
image for a later governed runtime claim; saving it grants neither runtime access nor permission to
run the upload. It does not treat a valid layout as evidence that the image is an MCP v2 server:
that evidence must come from the actual `server/discover` exchange after a governed runtime starts
the imported image.

An accepted conversation-tool proposal saves its invocation, readiness and executor work in one
PostgreSQL transaction. An exact repeated proposal recovers that executor even after it has
progressed; it cannot queue another call or reset the first one.

Before the companion receives provider arguments, the authorization participant rechecks current
conversation authority and can close denied Ready work with a failed result. A terminal winner
closes the MCP execution without contacting the provider. The claim is capped by the original run
deadline, active computer lease and frozen/current membership trust, within the configured claim
duration. The command also carries the exact tool revision's saved input schema, which the companion
uses to build MCP parameter headers. It never discovers a replacement schema during dispatch.
PostgreSQL checks the paired invocation claim and preserves its absolute expiry even if
the MCP write is delayed; the returned command uses that saved expiry.

History reads happen before the claim inside its bounded SQL transaction, while provider I/O stays
after commit. The history read does not create a cross-store lock. The conversation server now
owns model requests and result resumption: its Absurd workflow waits for the exact terminal tool
result and may reserve one text-only continuation within the original remaining allowance. The
ConversationComputer Pod does not schedule that work. After a run-owned companion claim commits,
the router waits for the injected `publishCurrentRunInvocation` callback. The conversation owner
records requested/running history and rechecks the exact claim after that work. A lost history
acknowledgement can recover within that same call from the exact saved receipt and entry. Only
success releases the original command. An unresolved history outage or ended authority withholds
it; the existing expiry worker moves an unused claimed invocation to recovery-required. A server
restart or uncertain command response never permits another provider claim. Discovery and caller-owned MCP tasks skip conversation
history. The private claim receipt is never sent to the Pod. Company credential activation and a
complete live retrieval journey remain unfinished.

An installed server can then run a tool through a public task. The task keeps its state, input,
result, and failure in the database, so a server restart does not repeat the tool call.

```
 caller sends POST /mcp/tasks with one server revision and tool revision
        │
        ▼
 database transaction
   ├── save the MCP task
   └── save its Absurd workflow job
        │
        ├── input needed ──► save the question ──► wait for POST /tasks/{id}/input
        │
        ▼
 recheck the exact MCP tool revision and save one ToolInvocation owned by this task
        │
        ▼
selected execution strategy runs the tool
   ├── OCI image ─────────► isolated companion owns the provider exchange
   ├── RemoteHttp ────────► server claims the call, reads exact connection material, and sends it
   ├── checked result ─────► task completed
   ├── definite failure ───► task failed
   ├── retries used up before the call starts ──► task failed; queued work closed
   ├── retries used up after the call starts ───► recovery required; claimed work closed under its saved fence
   └── uncertain outcome ──► recovery required; never run it again automatically
        │
        ▼
 terminal execution ──► controller deletes the exact saved Kubernetes Job UID
                    └──► database records cleanup; outages are retried
```

The draft server and its background job use one database transaction. Either both are saved, or
neither is saved. A repeated registration request returns the same draft and the same job.

Cancellation is also tied to the saved runtime claim. If the controller has taken a claim but has
not yet saved the Kubernetes Job UID, the task stays pending until that exact UID is saved. The
terminal cleanup claim can then delete the right Job. If provider execution has already started,
the cancellation request is refused instead of pretending that the tool call did not run.

Individual users browse the approved directory and install servers they may use. For OCI-backed
servers, the same response lists tools from the newest Ready server revision, including the frozen
input schema and digest an agent author must save. The API never returns credentials and never
labels an install connected before a real connection exists.

Company tool selection belongs to [agent services](../../../agents/agent-services/main/README.md).
Its administrator API publishes exact assignments and grants for the assistant's own Principal,
the service's saved identity. It does not create a connection or transfer a person's credentials.
Credential requirement is separate from the server's single-user, multi-user, or OAuth
presentation. A credentialless OCI server with a Ready image revision installs as `Credentialless`.
Every remote server installs as `NeedsCredential`, including one that will use a credentialless
connection, because no remote install becomes usable before its own connection generation is Active.
Uninstall moves the retained install from `Installed` to `Removing` while its connection workflow
revokes current generations and settles work that was already claimed. New discovery, readiness,
and dispatch checks reject `Removing`. The workflow marks the install `Removed` only after no
connection or claimed execution still needs that row; a later install may then reactivate the same
row with a fresh initial projection. Removed installs stay out of the user's installed list.

A connection command saves one immutable generation and its Absurd activation task in the same
transaction. Credentialless generations proceed without a Secret. Bearer generations store only a
verifier and immutable Secret identity in PostgreSQL; raw material stays in the dedicated MCP
credential namespace and exists briefly in process memory while the connect route transfers it to
custody, during authenticated discovery, or during a call.
The command also names the generation the caller observed, or `null` before the first generation.
The install row is locked before this expectation is checked. A new command with a stale expectation
is rejected before it can replace or revoke a generation. A repeated idempotency key succeeds only
when its saved generation, predecessor expectation, owner, endpoint, credential kind, and material
verifier still match; changing any of them is a conflict. Revocation applies the same generation
expectation before it changes the current connection.
If the Secret write succeeds before its SQL identity bind can be observed, the saved activation
workflow recovers that identity from matching metadata and the HMAC verifier without returning the
bearer material.

```text
current owner and ProviderConnection/Use authority
        │
        ▼
save generation + activation task
        │
        ├── credentialless ────────────────────────┐
        └── bearer ──► save/recover exact Secret ─┤
                                                   ▼
                                      server/discover + tools/list pages
                                                   │
                                                   ▼
                                  one SQL transaction rechecks authority
                                     ├── save RemoteHttp revision
                                     ├── save the complete tool set
                                     ├── grant the owner Read + Invoke
                                     └── mark revision Ready and connection/install Active
```

Discovery follows opaque continuation cursors with fixed page and tool limits. It rejects duplicate
tool names, cursor loops, changed cache scope, unsupported protocol evidence, and any finalization
whose current publication, installation, owner, endpoint, generation, task, or authorization no
longer matches. A replay returns the same Ready revision only when both discovery digests and every
saved tool digest match. Installation or connection state still does not prove that a provider call
has succeeded.

## Rules

- Registration, review, approval, publication, validation, and promotion require the caller's
  current `Organization/<silo>/Administer` grant. A login-session role is not an authorization path.
- A server must pass the saved protocol check before it may be approved.
- Network failures, timeouts, rate limits, and server errors are retried. Unsafe addresses and bad
  replies are saved as rejected so the same task cannot keep contacting an unchanged endpoint. A
  temporary failure is tried at most five times, with a longer delay before each later check.
- A user only sees and installs Published, Active servers when saved access grants allow that server.
  OCI servers also require a Ready image revision. A Streamable HTTP server may be installed after
  its saved protocol check is Accepted so its first connection can discover and save the Ready
  revision. Execution still requires the exact Principal's install and a Ready revision; a
  credentialless status is never inferred from the server's presentation type.
- Creating a public task atomically grants its creator `McpTask/Read`, `Edit`, and `Cancel`. Every
  read, required-input response, and cancellation rechecks that current task grant; creator identity
  and lifecycle fences narrow the operation but never replace authorization.
- An administrator may inspect tools on an unpublished or inactive server. The response marks those
  tools as blocked, and administrator visibility never grants execution permission.
- The package resolves each authenticated caller to a saved local Principal. It does not treat raw
  login claims as access rights.
- Route handlers use the authenticated user's silo. They do not accept a silo from the request body.

Before a companion claims an invocation, the runtime binds its TokenReviewed namespace,
ServiceAccount and Pod UID to the registered execution. It supplies that Pod and the verified Job
UID to current dispatch admission, so the audit identifies the executor actually requesting the
external effect. Missing Job coordinates cannot reach the provider claim.

Invocation completion now requires a result participant bound to the same database transaction.
It receives the current claim and admitted tool revision, with either the verified OCI executor
coordinates or the saved server-owned remote claim. Both paths save only the result accepted by
that participant. The conversation-file participant may replace an embedded CSV with metadata
only after saving its capture and workflow admission under the OCI executor's authority. Remote
calls accept ordinary results; embedded resources and the reserved CSV producer remain unavailable
because a remote response does not prove an executor Job or companion claim.
A participant failure, expired claim or conflicting invocation
completion aborts the transaction; raw resource content is never used as a fallback. The complete
original companion request remains the retry digest, even when its stored result is projected.
An unusable remote response leaves its dispatch evidence intact. Recovery closes the existing claim
without sending the provider another request; it cannot claim that an already-dispatched effect
did not happen.

Remote execution uses one database-measured claim allowance for credential lookup, the configured
HTTP timeout, and three bounded completion attempts. The executor anchors that allowance to a
monotonic process clock before the successful claim transaction, so credential delay reduces the
time available to the request instead of starting a fresh timeout. At the credential deadline it
cancels an in-flight Kubernetes Secret request; a database lookup that returns later cannot open one.
It bounds client waiting, keeps a completion reserve, and rechecks fresh
database time after result preparation before either terminal projection may commit. OCI companion
lease configuration does not determine this server-owned remote allowance.

## Public surface

`McpCompanionCommandKinds` exposes the existing companion command discriminant used by the public
runtime completion port. Server callers can construct that command through this package's facade.

`_ResolveMcpOciServerPromotionCaller` maps the verified browser principal to image-promotion authority.

- `_CreateOciImageArtifactResolver` resolves immutable image inputs through the artifact catalogue.

- `mcpOperatorRouter` — the Express router mounted at `/api/v1/mcp`.
- `__CreateMcpConnectionWorkflowAdmission`, `__RegisterMcpConnectionWorkflow`, and
  `__McpConnectionWorkflowController` — admit tasks before controller construction, then resume
  authenticated discovery, activation, and exact Secret cleanup through those saved tasks.
- `__McpConnectionAuthority` and `mcpConnectionRouter` — admit personal or managed-service
  connection generations through write-only commands and return only their safe status projection.
- Personal uninstall records its first lifecycle change in the audit log, retains every connection
  generation, and reports `Removing` until execution and credential cleanup are proven. If a Secret
  create response was lost before its UID and resource version were saved, cleanup recovers a
  verifier-matched identity before deletion. A missing or uncertain read cannot prove that the
  earlier create will not finish later, so bounded exhaustion retains failure evidence and leaves
  the install `Removing` instead of reporting false cleanup success.
- `__McpConnectionCredentialReader` — rechecks one claimed generation in SQL before reading its
  exact immutable Secret outside the transaction; credential material reaches only the immediate
  remote-call executor.
- `PrismaMcpConnectionReadinessRepository` — accepts a credentialless OCI install or the exact
  active remote connection generation for the execution Principal, and locks that install against
  uninstall without changing its projected status.
- `StandardMcpAuthenticatedConnectionDiscovery` — reads every bounded tool page through the standard
  remote MCP client and submits one complete, credential-free discovery command to SQL.
- `PrismaMcpRemoteRevisionFinalizerUnitOfWork` — rechecks the connection and current authority, then
  atomically creates or recovers the RemoteHttp revision, tool rows, owner grants, and projections.
- `registerRemoteServer` — saves a draft server and its protocol-check job together.
- `__CreateMcpEraProbeWorkflow` — registers the saved background job that checks the server.
- `__CreateOciImageValidationWorkflow` — registers the saved OCI image admission job.
- `mcpTaskRouter` and `__CreateMcpTaskWorkflow` — save, read, resume, cancel, and execute
  caller-owned MCP tasks through the selected OCI or RemoteHttp runtime.
- `__CreateMcpOciServerPromotionRouter` — promotes an imported image into a draft server revision and
  its first discovery execution after the current `Organization/Administer` grant check.
- `__CreateMcpRuntimeControllerRouter` — exposes the seven TokenReview-protected claim, assignment,
  release, Pod-registration, and terminal-cleanup routes used by the agent controller.
- `__CreateMcpRuntimeCompanionRouter` — exposes the three TokenReview-protected claim, completion,
  and failure routes used by one exact MCP companion Pod.
- `PrismaMcpRuntimeUnitOfWork` — owns the database transactions and delivery fences behind those
  public, controller, and companion routes.
- `_CreateMcpToolInvocationAdmission` binds proposal admission to the caller's existing transaction.
  The server supplies participants and deployment options; this package decides whether saved or new
  executor work satisfies the proposal.
- `PrismaMcpToolInvocationAdmissionRepository` — saves or recovers executor work inside the caller's
  existing transaction, including the conversation proposal transaction. It never opens a second
  transaction or contacts a provider.
- Operator services: `listEntitledCatalog`, `listInstalled`, `installServer`, `approveServer`, and
  `publishServer`. Catalogue server responses include the newest Ready OCI tool revisions in stable
  order. Generic central grant administration owns MCP sharing; this package has no separate access
  editor or subject directory.
- `_McpOpenapiPaths` — the OpenAPI path descriptions for this API.

## Boundary

The application supplies the database transaction and starts the Absurd worker. Routes never receive
a Prisma client. `PrismaMcpOperatorUnitOfWork` checks access, changes installs or server state, admits
background jobs, and records audit entries in one database transaction.

This package does not create Kubernetes workloads itself. It governs which servers are available,
promotes imported images, saves public tool tasks, issues database-fenced runtime work, and accepts
results only from the TokenReview-bound controller or companion Pod. It may create, read, and delete
only generation-named Secrets in the dedicated MCP credential namespace. The agent controller owns
runtime Kubernetes changes. The isolated companion performs OCI MCP exchanges, while the server
performs RemoteHttp exchanges after claiming the saved invocation and reading its exact connection.

## Dependency direction

Tagged `scope:mcp`: it may depend on the authentication guard, the shared authorization package, the
authenticated Principal directory, and the engine-neutral workflow contract. It never imports an app or
an Absurd package directly.

## Data and persistence

This package owns the public behavior around `McpServer`, `McpServerInstall`, `McpConnection`,
`McpTask`, and `OciImageValidation` in `apps/opencrane/prisma/schema/mcp.prisma` and
`apps/opencrane/prisma/schema/mcp-connections.prisma`. General `AuthorizationGrant` rows and product decision
evidence remain owned by the authorization package. `PrismaMcpOperatorUnitOfWork` binds the MCP
repositories and `AuthorizationAuthority` to the same public database transaction. Tool execution
rechecks `McpToolRevision/Invoke` before that transaction creates its durable `ToolInvocation`. The
invocation stores the exact allow decision's Principal, actor, tool/action coordinate, decision
digest, and silo-and-task-bound evidence digest. It leaves AgentRun membership and workload-assignment fields
empty because a caller-owned task has neither. The separate `McpTask` authorization coordinate
exists earlier because a task waiting for required input does not yet have the complete arguments
needed to create that invocation.
Remote discovery saves `discoveryEvidenceDigest` for the authenticated `server/discover` reply and
`discoveryDigest` for the pinned protocol, cache scope, and complete sorted tool set. Remote
revisions carry the exact connection id, generation, owner, and endpoint digest; OCI revisions keep
those remote coordinates empty. The finalizer writes no credential material.
`PrismaRuntimeMcpEffectEligibilityAuthority` owns the current MCP half of that check: it revalidates
the exact AgentRevision assignment, ready server revision, and active published server without
exposing MCP lifecycle tables to execution protocol code.

## See also

- Parent index: [gateways](../../README.md)
- Related packages: [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
