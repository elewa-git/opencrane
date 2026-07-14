# OpenCrane UI handoff — ownership manifest

## Rules

The most specific path wins, and no path may match two active owners. Public API changes, root route
mounts, provider registration, shared component APIs, workspace configuration, generated contracts,
and physical deletion are coordinator changes. Existing libraries may be touched by a lane only for
migration/parity; G4 deletion remains coordinator-owned after combined live acceptance.

| Path glob | Owner | Public seam / consumers | API/state owner | Migration source | Deletion owner | Wave |
|---|---|---|---|---|---|---|
| `plan.md`, `plan-done.md`, `CHANGELOG.md`, `apps/design_handoff/**` | Coordinator | Roadmap/history/handoff | Coordinator | Approved handoff | Coordinator | G0/G5 |
| `package*.json`, `nx.json`, `tsconfig*.json` | Coordinator | Workspace dependencies/aliases | Coordinator | Workspace config | Coordinator | G1/G4 |
| `apps/opencrane-ui/project.json`, `apps/opencrane-ui-e2e/{project.json,playwright.config.ts}`, `apps/opencrane-ui-e2e/src/support/**` | Coordinator | Nx and shared E2E harness | Coordinator | Existing app / new E2E project | Coordinator | G1/G2 |
| `apps/opencrane-ui/src/app/{app.config.ts,app.routes.ts}`, `apps/opencrane-ui/src/styles.scss`, `apps/opencrane-ui/public/fonts/**` | Coordinator | Root providers/routes/global theme | Existing gateway providers | Existing app | Coordinator | G1/G2/G4 |
| `apps/opencrane-ui/src/app/core/theme/**`, `apps/opencrane-ui/src/app/shared/components/**` | Coordinator | Frozen tokens/component APIs | Coordinator/shared presentation | Existing theme and UI elements | Coordinator | G1 |
| `libs/contracts/**` | Coordinator | Generated API contract | OpenCrane API | Generated contract | Coordinator | G0/G1 |
| `libs/frontend/core/**` | Coordinator | `@opencrane/core` models/API/theme | `ControlPlaneApiService` | Existing core | Coordinator | G1/G4 |
| `libs/frontend/elements/ui/**` | Coordinator | UI barrel used by both lanes/Tools/Context | Presentational | Existing UI elements | Coordinator | G1/G4 |
| `libs/frontend/state/core/**`, `libs/frontend/state/gateways/**` | Coordinator | Identity/cache/tokens/provider binding | Shared state/gateway provider | Existing state | Coordinator | G1–G4 |
| `libs/frontend/features/tools/**`, `libs/frontend/state/mcp/**`, `libs/frontend/state/tenant/**` | Coordinator; lanes read-only | `/tools`, `/admin`, customer-admin | MCP/tenant gateways | Existing features/adapters | Coordinator | Preserve/G4 |
| `apps/opencrane-ui/src/app/core/api/session-api.service.ts`, `apps/opencrane-ui/src/app/core/models/{session,citation}.types.ts`, `apps/opencrane-ui/src/app/core/state/session.facade.ts` | Workflow A | App-local Session seam | Existing conversation gateway/cache | Conversation state | Coordinator | A1–A3 |
| `apps/opencrane-ui/src/app/features/{workspace,session}/**` | Workflow A | Workspace/Session routes and views | Session facade | Existing workspace/conversation/context | Coordinator | A1–A3 |
| `libs/frontend/features/{workspace,conversation,context}/**` | Workflow A for parity | Existing route/view exports | Existing shared state | Same paths | Coordinator | A1–A4/G4 |
| `libs/frontend/state/conversation/{adapter,cache,render}/**` | Workflow A for parity | Live transport/cache/render; A2UI consumer | Conversation gateway/cache/render | Same paths | Coordinator | A2–A4/G4 |
| `apps/opencrane-ui-e2e/src/session/**`, `apps/opencrane-ui-e2e/src/visual-baselines/session/**` | Workflow A | Session evidence | E2E fixtures through shared support | New | Coordinator | A1–A4 |
| `apps/opencrane-ui/src/app/core/api/{settings,members,budgets,skills,channels,data-network,credentials}-api.service.ts` | Workflow B | App-local generated-client services | OpenCrane API / existing adapters | Settings/tools state | Coordinator | B1 |
| `apps/opencrane-ui/src/app/core/models/{settings,organization,budget,skill,channel}.types.ts`, `apps/opencrane-ui/src/app/core/state/settings.facade.ts` | Workflow B | Settings view models/facade | Existing settings/tenant/provider state | Existing settings state | Coordinator | B1 |
| `apps/opencrane-ui/src/app/features/settings/**` | Workflow B | Nested Settings routes/views | Settings facade | Existing Settings/Tools | Coordinator | B1–B4 |
| `libs/frontend/features/settings/**`, `libs/frontend/state/settings/**` | Workflow B for parity | Existing Settings feature/gateway | Settings gateway | Same paths | Coordinator | B1–B5/G4 |
| `libs/frontend/state/provider-key/**` | Workflow B with shared-consumer guard | Provider status/secret writes; `/admin` consumer | Provider-key gateway | Same path | Coordinator | B1/B4/G4 |
| `apps/opencrane-ui-e2e/src/settings/**`, `apps/opencrane-ui-e2e/src/visual-baselines/settings/**` | Workflow B | Settings evidence | E2E fixtures through shared support | New | Coordinator | B1–B5 |

## Stop conditions

1. Stop before commit if a lane-authored range contains an unmanifested path, coordinator path,
   other-lane path, or overlapping owner match.
2. Stop and request a coordinator patch for any public barrel/type/token/signature, root mount,
   provider, shared component API, global token, dependency, alias, or generated-contract change.
3. Stop A if it duplicates message/history/cache state, bypasses the gateway/render seam, removes an
   A2UI consumer, or enables Attach/Share without verified contracts.
4. Stop B if API/CLI/generated types or authorization are missing, fixture-only integrations appear
   functional, access tokens and provider credentials are conflated, secrets can be read back, or
   provider-key changes lack `/admin` regression coverage.
5. Stop either lane on a newly discovered external consumer. Update this manifest before resuming.
6. Stop all lane work if G1's frozen shared API must change. The coordinator repairs forward, reviews
   and records a replacement readiness SHA, then both machines synchronize to it.
7. Stop on failed build/lint/test/boundary/style/visual/accessibility/live gates, unexplained visual
   drift, unknown data/authorization ownership, secret leakage, or unresolved Critical/High review.

## Two-machine synchronization protocol

Both lanes branch from the exact recorded `UI_SHARED_READY_SHA`. Before synchronizing integration
into a lane, record its pre-sync tip. Audit lane-authored work as
`UI_SHARED_READY_SHA..PRE_SYNC_TIP`; record the coordinator merge SHA and audit later fixes as
`SYNC_SHA..HEAD`. The synchronization merge is the only ownership exception and appears separately
in the evidence bundle. Lanes never edit roadmap/history files.

No lane deletes legacy paths. G4 deletion requires the approved deletion-list entry, consumer search,
replacement tests, G3 live pass, a separate revertible commit, full G3 rerun, and independent review.
