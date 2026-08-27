# TypeScript Coding Guidelines

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.
> Review process and the self-review compliance table gate live in [`workflow.md`](./workflow.md).

## Codebase Architecture Context

Facts that make these rules concrete (verified against the tree, June 2026):

- **npm workspaces with integrated NX, pure ESM.** Every package is `"type": "module"`; `tsconfig.json` is `module: preserve`, `moduleResolution: bundler`, `target: es2023`, `strict`. Source-only libs use `project.json`; process/browser apps and deployment-only Helm rollups live in `apps/*`. Shared infra/util libs and backend capabilities live under `libs/`, compiled to `dist/` via esbuild where applicable. NX coordinates task dependencies and caching via `nx.json`; see [`app-specific.md`](./app-specific.md) for the live map.
- **Imports never carry an extension.** Write the file that exists on disk: `import { x } from "./config"`, not `./config.js`. Package specifiers are the same (`import { ClusterTenant } from "@opencrane/contracts"` — never `@opencrane/contracts.js`). This works because `tsc` only ever type-checks here (every invocation is `--noEmit`) and every runtime artifact is an `esbuild --bundle` output, so no relative specifier is ever resolved by Node's ESM loader. Keep the extension on non-TypeScript imports such as `.json`. If a branch predates this convention, run `node scripts/relative-import-extensions.mjs` rather than editing the import lines by hand.
- **`@opencrane/contracts` is the keystone.** All cross-package types, enums, CRD DTOs, and the generated typed API client (`___CreateControlPlaneClient`, plus the `paths` map emitted from the opencrane-server OpenAPI spec) live there and are re-exported from one barrel (`libs/contracts/src/index.ts`). New shared types go in a domain `*.types.ts` there, not duplicated per app.
- **The underscore naming convention is real and enforced repo-wide** — `___CreateControlPlaneClient`, `___AuthMiddleware`, `_RegisterTenants`, `_NamespaceFor` are all live examples. Match it; the [self-review table](#self-review-before-finishing) checks it.
- **Frameworks in use** (so the import-order example below reflects reality): opencrane-server is **Express 5** + Prisma + `@kubernetes/client-node`; the operator is `@kubernetes/client-node` + a custom watch loop; browser and external clients use the generated contracts client. Logging is `pino` everywhere.
- **Types-in-`*.types.ts` is observed with zero known deviations** — e.g. every opencrane-server route is a `route.ts` + `route.types.ts` pair. Keep it that way.

## Bracket Placement

Opening brackets `{` must be on their own line for classes and functions.

Exception: single-line functions may have the bracket on the same line.

```typescript
// WRONG
export class MyService {
	getData(): string {
		return "data";
	}
}

// CORRECT
export class MyService
{
	getData(): string
	{
		return "data";
	}
}
```

```typescript
function trimString(value: string): string { return value?.trim() ?? ""; }
```

## Arrow Functions

Never use arrow functions to declare standalone functions. Arrow functions are only allowed inside higher-order functions like `map`, `filter`, and `reduce`.

```typescript
// WRONG
const getUserName = (user: User): string => user.name;

// CORRECT
function getUserName(user: User): string
{
	return user.name;
}

// Arrow functions OK inside higher-order functions
const names = users.map(user => user.name);
const total = items.reduce((sum, item) => sum + item.price, 0);
```

## Inline Conditionals

A physical source line may contain at most one ternary conditional. When a line needs multiple
choices, expand each decision onto its own line or use an exhaustive lookup, a `switch`, or an
intention-revealing helper so every outcome remains independently reviewable.

```typescript
// WRONG — three decisions are compressed into one line.
return reason === FailureReason.Unavailable ? 503 : reason === FailureReason.NotFound ? 404 : 400;

// CORRECT — the enum-keyed table makes the mapping exhaustive and reviewable.
return _STATUS_BY_REASON[reason];
```

## If Body Placement

Every `if` body starts on the following physical line. This applies whether the body uses braces or
is a single `return`, `continue`, `throw`, assignment, or function call. Keeping the condition and
its effect on separate lines makes both parts easy to scan and gives future edits a stable place to
grow.

```typescript
// WRONG
if (decision.outcome !== AuthorizationDecisionOutcomes.Allow) continue;

// CORRECT — a short body may remain braceless, but it starts on the next line.
if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
	continue;

// CORRECT — braces follow the same rule.
if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
{
	continue;
}
```

## Named Work Steps

Do not call a method directly on a newly constructed production application object. When code
creates a repository, unit of work, gateway, authority, client, or other application class, name the
object before calling its method. Name a multi-field input as well. The reader can then inspect the
command and the operation separately.

```typescript
// WRONG — the command and the database operation are both hidden inside one expression.
await new PrismaGroupClaimProjectionUnitOfWork(prisma).reconcile({ siloId, issuer, subject, groups, log });

// CORRECT — each meaningful step has a stable name.
const cmd = { siloId, issuer, subject, groups, log };
const task = new PrismaGroupClaimProjectionUnitOfWork(prisma);
await task.reconcile(cmd);
```

This rule does not apply to test setup or standard value conversions such as
`new Date(value).toISOString()`. It is not a general ban on fluent APIs; it protects application
operations whose constructed dependencies and method call need separate review.

## Self-Review Before Finishing

After writing or editing any TypeScript file, run `scripts/agent-style-check.sh` — it checks
every mechanical rule below deterministically (ERROR = fix now; WARN = confirm at the cited
line). Use its output to populate the table; do **not** rely on "it feels right".

When a coding turn writes or edits `.ts` files, include a compact compliance table in the response:

| File | No standalone `=>` | Max one ternary/line | `if` body on next line | Imports single-line at top | All declarations JSDoc (incl. properties) | Comments in plain English | Types in `*.types.ts` | Naming convention | New test under `__tests__/` |
|---|---|---|---|---|---|---|---|---|---|
| `example.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Rules to check:

1. **No standalone arrow functions** — `setInterval`, `Promise`, `new Map()` callbacks must use named `function` expressions, not `() =>`.  Arrow functions are only permitted inside `map`, `filter`, `reduce`, `Array.from` (as a mapper), and equivalent pure functional HOFs.
2. **Imports: single-line, all at top** — Every import from a given package on one line. No import statements below the first non-import line. Two separate `import ... from "express"` lines is a violation — merge them.
3. **JSDoc on every declaration, including every interface property and every class field** — not just the enclosing type or class.
4. **Comments in plain English** — read each one aloud; if you would not say it that way to a colleague, rewrite it. No verbless noun piles, no ritual modifiers, no heavy word where a plain one exists, and `@see` instead of assuming a reference is known. See [Comment Language](#comment-language). This one is not mechanically checkable, so it is on you.
5. **Exported interfaces and type aliases in `*.types.ts`** — not in the implementation file.
6. **Function naming** — file-private: `_camelCase`; same-package export: `_PascalCase`; same-domain: `__PascalCase`; wide/global: `___PascalCase`.
7. **New tests under `__tests__/`** — a `*.test.ts` co-located next to the source file it tests, instead of under a `__tests__` directory, is a violation. See [Test File Location](#test-file-location).
8. **Categorical branches use documented string-backed enums** — confirm every
   `CATEGORICAL-LITERAL` warning is either replaced with the owning enum or is an explicit external
   protocol/schema/data exemption.
9. **At most one ternary conditional per physical line** — `INLINE-CONDITIONAL` is an error; expand
   each decision onto its own line or use an exhaustive lookup, `switch`, or named helper.
10. **Every `if` body starts on the following physical line** — `IF-BODY-NEWLINE` is an error. This
    includes braceless bodies and opening braces; keep the condition and its effect on separate lines.

The compliance table is **not** optional when TypeScript files were modified. If the table would be incomplete, fix the violations first.

The self-review table is a self-check and is **not** sufficient on its own — an independent review gate may still fire. See [Mandatory Independent Review](./workflow.md#mandatory-independent-review-policy-driven-gate) in `workflow.md`.

## String-Backed Enums For Categorical Control Flow

OpenCrane-owned categorical values must use a documented string-backed enum when they select a
control-flow branch, define a durable discriminated union, or cross a package, persistence, or API
boundary. Do not repeat serialized values in comparisons, `switch` cases, validators, schema
builders, or persistence filters.

The enum is the canonical vocabulary; its string values preserve readable JSON and existing wire or
database compatibility. Put a cross-package vocabulary in the lowest dependency-neutral model or
`@opencrane/contracts` package, then import it through that package's barrel. Keep adapter-only
Prisma enums at the persistence edge and map them explicitly.

Every enum needs JSDoc that explains its authority boundary, serialization commitments, and why the
categories exist. Every member also needs JSDoc that explains the domain meaning and any authority
it does or does not grant.

```typescript
// WRONG — the union and branch can silently drift from schemas and persistence filters.
export type AgentConfigPatch = { readonly kind: "persona_refresh" } | { readonly kind: "model_alias" };
if (patch.kind === "persona_refresh")
	return _StartInterview();

// CORRECT — one documented vocabulary retains the same serialized strings everywhere.
/**
 * Stable discriminants persisted with every personal configuration proposal.
 *
 * These values are shared by validation, storage filters, and public schemas.
 */
export enum AgentConfigPatchKinds
{
	/** Starts reviewed persona onboarding; it never carries replacement persona text. */
	PersonaRefresh = "persona_refresh",
	/** Selects a registered model alias for a future immutable agent revision. */
	ModelAlias = "model_alias",
}

export type AgentConfigPatch = { readonly kind: AgentConfigPatchKinds.PersonaRefresh } | { readonly kind: AgentConfigPatchKinds.ModelAlias };
if (patch.kind === AgentConfigPatchKinds.PersonaRefresh)
	return _StartInterview();
```

Do not manufacture enums for data that OpenCrane does not own: HTTP methods, MIME types, OpenAPI or
JSON-Schema keywords, Kubernetes kinds, third-party protocol constants, Prisma's generated enum
values, deliberate invalid-input fixtures, and one-off static identifiers remain strings. The
reviewer must confirm ownership and categorical reuse before reporting the style check's
`CATEGORICAL-LITERAL` warning.

## Inline Step Comments

Every function with 3 or more sequential steps must have a numbered inline comment before each step.

- The comment must explain what the step does.
- The comment must explain why the step is necessary.
- The comment must not just restate the method name.

```typescript
// WRONG — no comments, reader must infer intent from method names alone
async function provision(tenant: Tenant): Promise<void>
{
	await createServiceAccount(tenant);
	await createBucket(tenant);
	await createDeployment(tenant);
}

// CORRECT — each step is explained with context
async function provision(tenant: Tenant): Promise<void>
{
	// 1. ServiceAccount — grants the pod a GCP identity for Workload Identity.
	await createServiceAccount(tenant);

	// 2. BucketClaim — requests a per-tenant GCS bucket via Crossplane.
	await createBucket(tenant);

	// 3. Deployment — runs the tenant gateway with its durable state volume.
	await createDeployment(tenant);
}
```

## JSDoc Documentation

All declarations must have JSDoc comments. This includes **every interface property and class field**, not just the containing type or class.

```typescript
/** Service for managing tenant lifecycle */
export class TenantService
{
	/** The currently selected tenant */
	private currentTenant: Tenant | null = null;

	/**
	 * Fetches tenant by name from the cluster
	 * @param name - The tenant CR name
	 * @returns The tenant resource
	 */
	getTenant(name: string): Promise<Tenant>
	{
		return this.customApi.getNamespacedCustomObject({ name });
	}
}

/** Configuration options for the operator */
interface OperatorConfig
{
	/** Namespace to watch for Tenant CRs */
	watchNamespace: string;
	/** Default container image for tenant pods */
	tenantDefaultImage: string;
}
```

**WRONG — properties undocumented:**
```typescript
interface McpServerEntry
{
	id: string;
	name: string;
	endpoint: string;
}
```

**CORRECT — every property documented:**
```typescript
/** A registered MCP server entry returned by the catalog API. */
interface McpServerEntry
{
	/** Stable identifier used for deduplication across polls. */
	id: string;
	/** Human-readable name shown in the UI. */
	name: string;
	/** Fully-qualified URL of the MCP server endpoint. */
	endpoint: string;
}
```

## Comment Language

Write every comment in plain, simple English. A comment is read by someone who has never seen the
file, so it must land on the first pass. Density is not precision — a sentence nobody can parse
documents nothing.

Read the sentence aloud as if explaining the function to a colleague. **If you would never say it
out loud, rewrite it.**

### The six failure patterns

1. **No verb.** A noun pile is not a sentence. Start with a verb saying what the thing does.
2. **Ritual modifiers.** `only`, `exact`, `one`, `bounded`, `durable`, `canonical`, `safe`, `fixed`,
   `held`, `governed` sprinkled as decoration. Keep a modifier **only** when it states a restriction
   the reader must know, and delete it when it is ceremony. In "load state only when X" the `only`
   is real; in "append one bounded recovery event" it is noise.
3. **Compressed noun chains.** "an exact idempotent winner", "the invocation owner", "stale
   invocation". Name the real thing: which row, which caller, stale in what sense.
4. **Missing subject or invented verbs.** "the durable run still names the exact attempt" — nobody
   uses "names" that way. Say who does what to what.
5. **Unexplained shorthand.** "compare-and-set loss", "seam", "plane", "winner" — say what lost,
   what boundary, or what won.
6. **Heavy vocabulary with a plain equivalent.** Never `canonicalise`, `provenance`, `terminalise`,
   `materialise`, `posture`, `vocabulary`, `substrate`, `surface` (as a noun), `reify`, `elide`,
   `salient`, `coerce`. Use writes, origin, setup, field names, listener, convert.

Keep a term when it **names something real in the code** — a field, enum member, state, or standard
term with no plain equivalent: `fence` is an actual claim field, `Reconciling` an actual state,
`ProviderIdempotency` an actual recovery mode, and RFC 8785 canonicalization is the standard's own
name. Grep before you delete a word. When the term is real, simplify the sentence around it instead.
Precision beats plainness: never trade away accuracy to sound simpler, and never drop the *why*.

### Reference other code with `@see`

Do not assume a reader knows what a noun phrase points at. When a comment leans on something defined
elsewhere — "the immutable snapshot", "the held transaction" — either name the real symbol or add a
`@see` tag. Add `@see` only for a concept **not already visible in the signature** (IDEs link
parameter types), and only after grepping to confirm the exact exported name exists.

**External specs and third-party services get a `@see` with the URI.** Whenever a comment leans on
something defined outside this repo — the MCP protocol, AG-UI, A2UI, an RFC, or a third-party service
such as LiteLLM, Zitadel or CNPG — link it. A reader must not have to go searching for the
document that makes the code correct.

- **Link the pinned revision, not the latest.** If the code pins `2025-06-18`, link that revision's
  page. A link to a newer spec silently misdescribes the code.
- **Never invent a URL.** Confirm it resolves and is the right version before committing it. A
  fabricated or wrong-version link is worse than none, because it will be trusted.
- Say what the link is *for*, not merely that it exists.

```typescript
/**
 * MCP protocol revision this client announces, and the only one it will accept back.
 * ...
 * @see https://modelcontextprotocol.io/specification/2025-06-18 — the revision pinned here.
 */
const _MCP_PROTOCOL_VERSION = "2025-06-18";
```

```typescript
// WRONG — no verb, ritual modifiers, invented verb, and a reference the reader must already know
/** Transaction-owned construction boundary for the recovery-event repository. */
/** Verify only an exact idempotent winner after a compare-and-set loss. */
/** Load state only when the durable run still names the exact attempt. */
/** Derive the model-key request from the immutable snapshot and exact claim generation. */

// CORRECT — a verb, a subject, and a pointer to what the reader has to look up
/** Builds the recovery-event repository against a transaction the caller already holds. */
/** Checks that the row which won the insert race is the same request we tried to write. */
/** Loads the state only if the run row in the database is still on this attempt. */
/**
 * Builds the model-key request from the run's frozen inputs and the claim that won.
 * @see RunInputSnapshot
 * @see ToolInvocationClaim
 */
```

### Exported types, classes and methods get heavy JSDoc

A one-line label is not documentation. **Prioritise rich JSDoc on exported methods, classes, and
types** — these are what another engineer meets first, and hovering one must be enough to use it
correctly without opening the implementation. Give context, not a restatement of the name:

- **What it does**, in plain words.
- **Why it exists / when you hit it** — the situation that produces this, and what a caller must do
  differently for each outcome. This is the part that is usually missing.
- **Who calls it** — a `Called by:` line naming the real callers for an exported function or port.
  Grep for them; never guess. It is the fastest way for a reader to find the flow this sits in.
- **The tags**: `@param`, `@returns`, `@throws`, `@see`, `@implements`, `@deprecated`. Use
  `@throws` whenever the function can throw, and `@returns` to spell out what each outcome means —
  not just its type, which the signature already gives.
- `{@link Other}` inline when naming a sibling member the reader will want next.

```typescript
// WRONG — a label. The reader still has to open the implementation to use this.
/** Stable categories returned by durable cancellation authority. */
export enum RunCancellationResultStatuses

// CORRECT — the distinction that actually matters, and what happens if you get it wrong
/**
 * What happened when someone asked to cancel a run.
 *
 * Cancelling is two jobs, and this status says which is left: the database marks the run stopped,
 * and then any Kubernetes Job it created has to be deleted by a later worker pass. So `Cancelling`
 * means "stopped, cleanup still owed" and `Cancelled` means "stopped, nothing left to delete". A
 * caller that treats them as the same will report a run as torn down while its pod still runs.
 * @see RequestRunCancellationResult for the payload carried with each status.
 */
export enum RunCancellationResultStatuses
```

### Enums get the most care of anything

**Enums usually encode state**, so a vague enum comment is the most expensive kind. Someone will
branch on these values, persist them, and compare them across a version boundary. Document an enum
as if the reader is about to write that branch.

The comment on the **enum itself** must answer four questions:

- What is it for — the decision this enum exists to drive?
- Where is it used — which layers read it and branch on it?
- Where is it stored — a database column, an API payload, or memory only? If it is persisted or sent
  over the wire, does renaming a member mean a migration or a breaking API change?
- Is the set closed, and what happens if an unknown value arrives?

**Answer them as prose, and never write the questions into the comment.** These are a checklist for
you, not a template for the reader. A comment with `**What it is for.**` / `**Where it is stored.**`
headings is a filled-in form, not documentation — fold the answers into ordinary sentences in
whatever order reads best, and leave out a question that genuinely does not apply.

On **every member**, say what state it infers — what is true of the system when that value holds,
not a restatement of the name. Include what the holder must do next, what it may no longer do, and
whether the state is terminal.

```typescript
// WRONG — restates the name; a reader still cannot branch on it safely
/** Runtime appended a bounded message delta. */
MessageDelta = "message.delta",
/** The run is fenced while physical cleanup remains. */
Cancelling = "cancelling",

// CORRECT — the member says what is true, and what it obliges the caller to do
/** The runtime added the next piece of a message it is still writing. Payload: `messageId` and `delta`, the new text. */
MessageDelta = "message.delta",
/** The run is stopped, but a Kubernetes Job may still exist and cleanup is owed. Not terminal: a later worker pass finishes it. */
Cancelling = "cancelling",
```

The enum block folds the four answers into prose. Both examples below cover the same ground — what
it is for, who reads it, whether it is stored, and how closed the set is — without ever naming a
question:

```typescript
/**
 * Every kind of event one agent run can emit, in the order a reader would meet them.
 *
 * The string values are stored in the database and read by clients, so they cannot be renamed
 * without a migration. Holding one of these values grants nothing on its own: an event says what
 * happened, it does not authorise anything.
 */

/**
 * What happened when someone asked to cancel a run, and how much of it is left to do.
 *
 * Cancelling is two jobs rather than one. The database marks the run so no further work is accepted,
 * then, if a Kubernetes Job may already exist, that Job has to be deleted in a separate worker pass.
 * Hence two success values: `Cancelling` is stopped with cleanup still owed, `Cancelled` is stopped
 * with nothing left to delete. A caller that treats them as the same will report a run as fully torn
 * down while its pod is still running.
 *
 * The repository returns exactly one of these and the HTTP layer maps it to a response; nothing
 * inside the transaction branches on it. None of them are persisted, so renaming a member needs no
 * migration, though it is still a breaking change for API clients.
 */
```

If the enum drives a lifecycle, also follow the state-machine rules in
[`maintainability.md`](./maintainability.md) — a durable enum that selects two or more
commands/events needs a State×Event table, not just good prose.

## Type And Interface File Separation

Interfaces and exported types must live in dedicated type files, not mixed with implementation logic.

- Use `*.types.ts` files for exported interfaces, type aliases, and DTO shapes.
- Keep runtime/business logic in separate implementation files.
- If a module needs shared types, import them from its paired `*.types.ts` file.

```typescript
// WRONG: interface and runtime logic mixed in one file
export interface ResolveResult
{
	status: "ok" | "error";
}

export function _Resolve(): ResolveResult
{
	return { status: "ok" };
}

// CORRECT: split files
// resolve.types.ts
export interface ResolveResult
{
	status: "ok" | "error";
}

// resolve.ts
import type { ResolveResult } from "./resolve.types";

export function _Resolve(): ResolveResult
{
	return { status: "ok" };
}
```

## Runtime Validators Stay Beside Their Models

When untrusted runtime data is expected to become a TypeScript model, keep its Zod validator in the
same folder and package as that model. Pair `example.types.ts` with `example.validator.ts`; export
the validator through the model package instead of rebuilding the accepted fields in an HTTP
adapter, router, repository, or generic utility.

The validator module starts with a clarifying comment that names the trust boundary and why the
model and validator must change together. Type each Zod schema against its TypeScript interface so
drift fails compilation. Choose `.strict()` or `.strip()` deliberately from the protocol contract,
and keep cross-field invariants in the model-adjacent validator. Transport code may bound and decode
JSON, authenticate, and interpret protocol status, but it delegates domain-shape validation.

```typescript
// WRONG — the transport owns a second, hand-written copy of the model.
function _ParseClaim(value: unknown): WorkloadClaim
{
	if (!value || typeof value !== "object" || /* many inline field checks */) throw new Error("invalid claim");
	return value as WorkloadClaim;
}

// CORRECT
// workload.types.ts exports WorkloadClaim.
// workload.validator.ts owns a ZodType<WorkloadClaim> and exports _ParseWorkloadClaim.
// http-workload-authority.ts only bounds JSON and delegates to _ParseWorkloadClaim.
```

## Test File Location

Test files live under a `__tests__` directory next to the source they cover, never co-located as
a sibling `*.test.ts` file.

- `src/foo.ts` is tested by `src/__tests__/foo.test.ts`, not `src/foo.test.ts`.
- Fix relative imports accordingly (`./foo.js` becomes `../foo.js` once the test moves down a
  directory level).
- Checked mechanically by `scripts/agent-style-check.sh` (`TEST-LOCATION`) — a co-located
  `*.test.ts` is an ERROR, not a style suggestion.

```typescript
// WRONG
// libs/backend/example/main/src/widget.test.ts
import { Widget } from "./widget";

// CORRECT
// libs/backend/example/main/src/__tests__/widget.test.ts
import { Widget } from "../widget";
```

## Custom HTTP Response Headers

Non-standard response headers (the `X-*` prefix convention) must include an inline comment that explains:

1. **Why** the header is being set — what the receiver does with it.
2. **Which standard or convention** it follows, with a `@see` URL.

The `X-` prefix was deprecated for IANA registration by RFC 6648 but remains the standard practice for private/internal headers.

```typescript
// Content-Type: standard HTTP header (RFC 9110 §8.3) — tells the consumer
// how to parse the response body.
// @see https://www.rfc-editor.org/rfc/rfc9110#section-8.3
res.setHeader("Content-Type", bundle.contentType ?? "text/markdown");

// X-Widget-Name / X-Widget-Digest: proprietary identification headers using
// the informal X- prefix (RFC 6648 deprecated IANA use but convention remains
// standard for private headers).  Allow the receiver to cache and forward
// identity without parsing the URL.
// @see https://www.rfc-editor.org/rfc/rfc6648
res.setHeader("X-Widget-Name", widget.name);
res.setHeader("X-Widget-Digest", digest);
```

## Function Naming Conventions

Use underscore prefixes to indicate scope and visibility.

- `function _functionName`: same file only
- `function _FunctionName`: same package
- `function __FunctionName`: same domain
- `function ___FunctionName`: wide or global application use

| Pattern | Scope | Usage |
|---------|-------|-------|
| `function _functionName` | Same file only | Local helper consumed within the same file |
| `function _FunctionName` | Same package | Shared within the same workspace package |
| `function __FunctionName` | Same domain | Shared across closely related packages |
| `function ___FunctionName` | Wide/global | Shared across the entire application |

```typescript
// Local to this file only (not exported)
function _formatDate(date: Date): string
{
	return date.toISOString().split("T")[0];
}

// Exported for use within the same package
export function _FormatTitle(title: string): string
{
	return title.trim().toUpperCase();
}

// Exported for use across related packages
export function __FormatStatus(status: string): string
{
	return `STATUS.${status}`;
}

// Exported for wide use across the entire application
export function ___FormatDisplayName(firstName: string, lastName: string): string
{
	return `${firstName} ${lastName}`.trim();
}
```

## Import Order

Imports should be ordered from furthest dependency to closest, grouped by family.

- 1. Node builtins
- 2. External utils and helpers
- 3. External frameworks
- 4. Local packages
- 5. Local file imports

```typescript
// 1. External libraries - Utils/Helpers
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// 2. External libraries - Framework
import express from "express";
import * as k8s from "@kubernetes/client-node";
import pino from "pino";

// 3. Local packages - Types/Models (package specifier — no extension)
import type { Tenant, AccessPolicy, OperatorConfig } from "@opencrane/contracts";

// 4. Local file imports (same package — relative, no extension)
import { applyResource, deleteResource } from "./reconciler";
import type { CreateTenantRequest } from "../types";
```

| Priority | Category | Example |
|----------|----------|---------|
| 1 | Node builtins | `node:fs`, `node:path`, `node:crypto` |
| 2 | External - Utils | `date-fns`, `lodash` |
| 3 | External - Framework | `express`, `@kubernetes/client-node`, `pino`, `@prisma/client` |
| 4 | Local packages | `@opencrane/contracts`, `@opencrane/backend/observability` |
| 5 | Local file imports | `./reconciler`, `../types` |

## Single-Line Imports

All imports from a single package must be on one line.

- Never split a single import declaration across multiple lines.

```typescript
// WRONG
import {
	TenantSpec,
	TenantStatus,
	AccessPolicySpec,
	OperatorConfig,
} from "./types";

// CORRECT
import { TenantSpec, TenantStatus, AccessPolicySpec, OperatorConfig } from "./types";
```

## Barrel Exports

Each workspace package should have a single barrel export file at the package root (`src/index.ts`).

- Import from the package barrel.
- Do not import from internal package source paths.

```typescript
// CORRECT
import { __CreateRuntimeController } from "@opencrane/backend/agents/runtime/controller";

// WRONG
import { __CreateRuntimeController } from "../../../libs/backend/agents/runtime/controller/src/core/runtime-controller";
```
