# OpenCrane UI handoff — mock ownership manifest

## Rules

The most specific path wins, and no path may match two active owners. Mock models/services/facades,
shared components, root routes, configuration, and physical deletion are coordinator-owned. Lanes
compose frozen mock facades and shared components; they never add network calls or edit backend-facing
packages.

| Path glob | Owner | Public seam / consumers | Mock/state owner | Migration source | Deletion owner | Wave |
|---|---|---|---|---|---|---|
| `plan.md`, `plan-done.md`, `CHANGELOG.md`, `apps/design_handoff/**` | Coordinator | Roadmap/history/handoff | Coordinator | Approved handoff | Coordinator | G1/G5 |
| `package*.json`, `nx.json`, `tsconfig*.json` | Coordinator | Workspace dependencies/aliases | Coordinator | Workspace config | Coordinator | G1/G4 |
| `apps/opencrane-ui/project.json`, `apps/opencrane-ui-e2e/{project.json,playwright.config.ts}`, `apps/opencrane-ui-e2e/src/support/**` | Coordinator | App and E2E harness | Mock scenario/reset helpers | Existing app / new E2E | Coordinator | G1/G2 |
| `apps/opencrane-ui/src/app/{app.config.ts,app.routes.ts}`, `apps/opencrane-ui/src/styles.scss`, `apps/opencrane-ui/public/fonts/**` | Coordinator | Root route/provider/theme seam | Mock-mode provider registration | Existing app | Coordinator | G1/G2/G4 |
| `apps/opencrane-ui/src/app/core/{models,mocks,state,theme}/**`, `apps/opencrane-ui/src/app/shared/components/**` | Coordinator | Frozen models, mock services, facades, tokens, components | Coordinator | Approved handoff/existing UI concepts | Coordinator | G1/G4 |
| `apps/opencrane-ui/src/app/features/workspace/workspace.routes.ts`, `apps/opencrane-ui/src/app/features/settings/settings.routes.ts` | Coordinator through `UI_SHARED_READY_SHA`, then Workflow A / Workflow B | Buildable placeholder route arrays | Frozen route seam | New | Coordinator | G1 then A1/B1 |
| `libs/contracts/**`, `libs/backend/**`, `apps/opencrane/src/**`, `apps/cli/**` | Read-only / out of scope | Backend and CLI | None for this handoff | None | None | Never |
| `libs/frontend/state/**`, `libs/frontend/platform/**` | Read-only / out of scope | Existing live state/adapters/platform | None for this handoff | UI concepts only | Coordinator only if separately approved | Preserve |
| `libs/frontend/features/tools/**`, `libs/frontend/features/{welcome,customer-admin}/**` | Read-only / out of scope | `/tools`, `/admin`, other routes | None for this handoff | UI concepts only | Coordinator only if separately approved | Preserve |
| `apps/opencrane-ui/src/app/features/{workspace,session}/**` | Workflow A | Workspace/Session routes and views | `SessionFacade` | Existing Workspace/Conversation/Context | Coordinator | A1–A4/G4 |
| `apps/opencrane-ui-e2e/src/session/**`, `apps/opencrane-ui-e2e/src/visual-baselines/session/**` | Workflow A | Session evidence | Shared E2E support | New | Coordinator | A1–A4 |
| `apps/opencrane-ui/src/app/features/settings/**` | Workflow B | Nested Settings routes/views | `SettingsFacade` | Existing Settings/Tools concepts | Coordinator | B1–B5/G4 |
| `apps/opencrane-ui-e2e/src/settings/**`, `apps/opencrane-ui-e2e/src/visual-baselines/settings/**` | Workflow B | Settings evidence | Shared E2E support | New | Coordinator | B1–B5 |

## Stop conditions

1. Stop before commit if a lane range contains an unmanifested, coordinator, other-lane, backend,
   CLI, generated-contract, deployment, or live-state path.
2. Stop and request a coordinator patch for any model, mock service, facade, shared component API,
   route mount, global token, dependency, alias, scenario, clock, or reset change.
3. Stop if a component owns fixture arrays, mutable singleton state, random IDs/time, or timers not
   controlled by the shared mock clock.
4. Stop if the implementation makes network calls or claims mock permission behavior proves security.
5. Stop if secret-shaped data enters persistence, URLs, logs, DOM attributes, or snapshots.
6. Stop on failed lint/test/build/boundary/style/visual/accessibility gates, unexplained visual drift,
   overlapping dirty work, or unresolved Critical/High review findings.

The G1 route stubs transfer to their named lane at `UI_SHARED_READY_SHA`; replacing their placeholder
arrays is the only pre-authorized edit to a coordinator-created file.

## Two-machine synchronization

Both lanes branch from the recorded `UI_SHARED_READY_SHA`. Before synchronization, record lane two's
`PRE_SYNC_TIP` and audit `UI_SHARED_READY_SHA..PRE_SYNC_TIP`. Merge the updated integration branch,
record `SYNC_SHA`, and audit later fixes as `SYNC_SHA..HEAD`. The coordinator integration merge is the
sole ownership exception and is reported separately; its lane-one paths are not lane-two authorship.
Lanes never edit roadmap/history files or delete legacy paths.
