# Source and discovery user stories

## Feature intent

Let administrators register bounded discovery sources and review what they report without silently
installing discovered capabilities or converting external metadata into trusted authority.

Current status: `API partial`, `UI missing`, `Design ready` after contract and authorization repair.

## SRC-01 — Browse third-party sources

**As an** organisation administrator, **I want** to see registered discovery sources and their health
**so that** I understand where candidate capabilities originate.

Acceptance criteria:

- Kind is `mcp-registry`, `anthropic-skills`, `git-repository`, or `manual-upload`.
- Status is `healthy`, `syncing`, `error`, or `pending-approval`.
- Sync mode is `scheduled` or `manual`.
- Last sync, next run, origin, notes, item count, empty, loading, unavailable, and error states are
  covered.

API: `GET /api/v1/third-party-sources`.

## SRC-02 — Register or edit a source

**As an** organisation administrator, **I want** to create or edit a source **so that** discovery has
an explicit origin and synchronization policy.

Acceptance criteria:

- Inputs use `kind`, `originUrl`, `status`, `syncMode`, schedule fields, and notes where applicable.
- URL/credential handling is type-specific and secrets are never returned in list/detail reads.
- Validation, duplicate, unreachable, forbidden, and saved-but-not-yet-synced states are defined.

APIs: `POST /api/v1/third-party-sources`, `GET/PUT /api/v1/third-party-sources/{id}`.

Status: `API partial`; OpenAPI still documents `type`, `url`, and `syncStatus`, and role/silo guards
are insufficient.

## SRC-03 — Review discovered items

**As an** organisation administrator, **I want** to inspect discovered candidates before governance
**so that** discovery never implies installation, publication, or executable trust.

Acceptance criteria:

- Each item identifies its source, discovered type, upstream identity, sync observation, and
  governance status.
- The only currently supported discovered item type is `mcp-server`.
- Actions lead into explicit MCP review/governance rather than direct activation.

API: discovered items are included in third-party-source responses; no independent lifecycle route.

## SRC-04 — Remove a source safely

**As an** organisation administrator, **I want** to remove a discovery source **so that** future sync
stops without silently deleting separately governed catalogue entries.

Acceptance criteria:

- Confirmation explains what remains, what stops syncing, and what requires separate governance.
- In-progress sync, already removed, forbidden, and dependency failure states are covered.

API: `DELETE /api/v1/third-party-sources/{id}`.
