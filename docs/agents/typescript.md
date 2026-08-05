# TypeScript Coding Guidelines

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.
> Review process and the self-review compliance table gate live in [`workflow.md`](./workflow.md).

## Codebase Architecture Context

Facts that make these rules concrete (verified against the tree, June 2026):

- **npm workspaces with integrated NX, pure ESM.** Every package is `"type": "module"`; `tsconfig.json` is `module: NodeNext`, `target: es2023`, `strict`. Source-only libs use `project.json`; process/browser apps and deployment-only Helm rollups live in `apps/*`. Shared infra/util libs and backend capabilities live under `libs/`, compiled to `dist/` via esbuild where applicable. NX coordinates task dependencies and caching via `nx.json`; see [`app-specific.md`](./app-specific.md) for the live map.
- **Import extensions follow NodeNext, and this is the most common mistake:** *relative* imports MUST end in `.js` (`import { x } from "./config.js"`), but *package* specifiers MUST NOT (`import { ClusterTenant } from "@opencrane/contracts"` — never `@opencrane/contracts.js`).
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

## Self-Review Before Finishing

After writing or editing any TypeScript file, run `scripts/agent-style-check.sh` — it checks
every mechanical rule below deterministically (ERROR = fix now; WARN = confirm at the cited
line). Use its output to populate the table; do **not** rely on "it feels right".

When a coding turn writes or edits `.ts` files, include a compact compliance table in the response:

| File | No standalone `=>` | Imports single-line at top | All declarations JSDoc (incl. properties) | Types in `*.types.ts` | Naming convention | New test under `__tests__/` |
|---|---|---|---|---|---|---|
| `example.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Rules to check:

1. **No standalone arrow functions** — `setInterval`, `Promise`, `new Map()` callbacks must use named `function` expressions, not `() =>`.  Arrow functions are only permitted inside `map`, `filter`, `reduce`, `Array.from` (as a mapper), and equivalent pure functional HOFs.
2. **Imports: single-line, all at top** — Every import from a given package on one line. No import statements below the first non-import line. Two separate `import ... from "express"` lines is a violation — merge them.
3. **JSDoc on every declaration, including every interface property and every class field** — not just the enclosing type or class.
4. **Exported interfaces and type aliases in `*.types.ts`** — not in the implementation file.
5. **Function naming** — file-private: `_camelCase`; same-package export: `_PascalCase`; same-domain: `__PascalCase`; wide/global: `___PascalCase`.
6. **New tests under `__tests__/`** — a `*.test.ts` co-located next to the source file it tests, instead of under a `__tests__` directory, is a violation. See [Test File Location](#test-file-location).
7. **Categorical branches use documented string-backed enums** — confirm every
   `CATEGORICAL-LITERAL` warning is either replaced with the owning enum or is an explicit external
   protocol/schema/data exemption.

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
if (patch.kind === "persona_refresh") return _StartInterview();

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
if (patch.kind === AgentConfigPatchKinds.PersonaRefresh) return _StartInterview();
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
import type { ResolveResult } from "./resolve.types.js";

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
import { Widget } from "./widget.js";

// CORRECT
// libs/backend/example/main/src/__tests__/widget.test.ts
import { Widget } from "../widget.js";
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

// 3. Local packages - Types/Models (package specifier — NO .js)
import type { Tenant, AccessPolicy, OperatorConfig } from "@opencrane/contracts";

// 4. Local file imports (same package — relative, WITH .js)
import { applyResource, deleteResource } from "./reconciler.js";
import type { CreateTenantRequest } from "../types.js";
```

| Priority | Category | Example |
|----------|----------|---------|
| 1 | Node builtins | `node:fs`, `node:path`, `node:crypto` |
| 2 | External - Utils | `date-fns`, `lodash` |
| 3 | External - Framework | `express`, `@kubernetes/client-node`, `pino`, `@prisma/client` |
| 4 | Local packages | `@opencrane/contracts`, `@opencrane/backend/observability` |
| 5 | Local file imports | `./reconciler.js`, `../types.js` |

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
} from "./types.js";

// CORRECT
import { TenantSpec, TenantStatus, AccessPolicySpec, OperatorConfig } from "./types.js";
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
