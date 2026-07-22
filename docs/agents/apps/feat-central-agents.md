# App: feat-central-agents (`@opencrane/feat-central-agents`)

> Deep-dive for `apps/feat-central-agents`. Index: [`../app-specific.md`](../app-specific.md). Verified June 2026.

A standalone **background ingestion worker** (not API-first) that pulls external documents, normalises
them to the org-index schema, and pushes them into Cognee so tenant pods can query org context via
the official `@cognee/cognee-openclaw` plugin. Currently one connector: **Slack**.

## App vision

This app is not a harvester — harvesting is one job it happens to do first. The target for
`feat-central-agents` is a **host for central agents**: org-, department-, team-, or otherwise shared
**managed AgentServices** that an administrator defines, that run on a schedule or a specific trigger,
and that each do one bounded task. Central agents run on the **same runtime substrate as personal
agents** (the suspended one-attempt Job, controller, and outbound-only shell) but under a **narrower,
connector-scoped workload identity** independent of any human user, and they reach external systems
**only through Obot-custodied MCP servers**, instantiable per connected source rather than a bespoke
SDK loop, and each central agent reads/writes only the canonical scopes it is explicitly attached to.

The current interval worker described below is the migration starting point, not the product
boundary: its useful behaviour (normalisation, checkpointing, scoped Cognee writes) is re-expressed as
a packaged central-agent definition over an approved Obot MCP server, after which the bespoke
connector and its direct credential handling are removed. See the direct-refactor plan's Phase E2 and
issue [#129](https://github.com/italanta/opencrane/issues/129) for the full model.

## Loop (`src/index.ts`)

On boot: read Slack config (`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_IDS`, `SLACK_MAX_MESSAGES_PER_CYCLE`, `SLACK_SYNC_INTERVAL_MS` default 15min), `COGNEE_ENDPOINT`, `DATABASE_URL`; start a metrics HTTP server (`METRICS_PORT`, default 9090); init Prisma. Runs an immediate sync then repeats on the interval. Each cycle: load cursor → `connector.sync(cursor)` → `_IngestDocuments` → save cursor on progress → record metrics. Errors are caught per-cycle and retried next interval.

## Slack connector (`src/connectors/slack.connector.ts`)

Per channel, calls `conversations.history` with `oldest = cursor` (incremental), normalises each message to a `NormalizedDocument` (`source`, `sourceId = channel/ts`, `owner`, `content`, `aclOrigin = slack:channel-membership`, `sourceUpdatedAt`, `freshnessRecordedAt`, `ingestCursor`), tracking the latest `ts` as the next cursor. Skips empties, non-`message` types, and unparseable timestamps.

## Ingestion (`src/ingestion.ts`, `src/cognee-client.ts`, `src/org-index-schema-v2.ts`)

Documents are processed **sequentially** (isolates transient failures, lets the cursor advance atomically): validate against org-index schema v2 (required fields + ISO-8601-UTC timestamp pattern; conformance issues are logged, not fatal) → `POST {cognee}/v1/add` with the content + metadata, routed to a dataset by `scope/subject` (e.g. `team/platform`) or `org`. Cursor persisted in the `HarvestingCursor` Prisma table.

## Surface & metrics (`src/metrics.ts`)

`GET /healthz` + `GET /metrics` (per-source `totalIngested`, `lastSyncAt`, `lagSeconds`, `lastSyncSuccess`, `lastError`).

## Aspirational / stubs

Only Slack today (Confluence/GitHub/etc. deferred). `sensitivityTags` is hardcoded `["slack"]` — fine-grained classification is a later phase, as is OAuth2/credential rotation.
