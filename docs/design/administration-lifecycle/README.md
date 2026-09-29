# Organisation administration: design brief

Status: proposed product design, 25 September 2026. This brief does not mark the journeys as implemented or approve new permission rules.

## Outcome

An organisation administrator can configure models, connect company tools, manage people and recover from interrupted changes without an engineer, terminal, API client or database access.

Today, an engineer can configure substantial parts of OpenCrane. The administrator cannot independently manage the whole lifecycle. The design must connect the existing capabilities into complete tasks, including maintenance and removal, rather than add isolated settings forms.

Use the [screenshot guide](screenshots.md) alongside this brief. It includes ten existing OpenCrane Storybook references and one attributed OC8 architecture screenshot. These are evidence and inspiration, not approved target screens or proof of live journeys.

The supplied frontend wireframes are stored as [36 indexed design targets](../../../tests/design-targets/organisation-administration/README.md) under `tests/design-targets/organisation-administration/`. Use that index for full-resolution desktop and narrow references, source checksums, test guidance and required corrections to the prototype.

## Delivery issues

The grouped delivery tracker is [#907](https://github.com/elewa-git/opencrane/issues/907).

| Group | Issue |
| --- | --- |
| Navigation, overview and local change history | [#904](https://github.com/elewa-git/opencrane/issues/904) |
| Models and providers | [#224](https://github.com/elewa-git/opencrane/issues/224) |
| MCP install, connection, updates and removal | [#905](https://github.com/elewa-git/opencrane/issues/905) |
| People and invitations | [#226](https://github.com/elewa-git/opencrane/issues/226) |
| Departments, teams, groups and effective access | [#906](https://github.com/elewa-git/opencrane/issues/906), using [#764](https://github.com/elewa-git/opencrane/issues/764) |
| Skills follow-up | [#222](https://github.com/elewa-git/opencrane/issues/222) |
| Scheduled workflows follow-up | [#848](https://github.com/elewa-git/opencrane/issues/848) |

The existing issue owners have received the relevant target references and acceptance criteria. Reconcile historical issue descriptions with the implementation branch, especially standalone/Fleet membership authority. Start with current contracts and shared component states, then deliver each primary lifecycle journey end to end; skills and scheduled workflows remain explicit follow-ups.

## Audience and scenario

The primary user is an organisation administrator who understands their company's systems but does not administer Kubernetes. An employee connects their own account when an integration needs personal credentials. An infrastructure operator handles installation, identity-provider setup and failures outside the administrator's authority.

Design around a fictional Kenyan distributor, Kijani Supplies. Its administrator Amina needs to connect a model provider, allow the sales team to use an Odoo integration, invite a colleague, then remove that colleague's access later. Use example.com identities and dummy credentials in all prototypes.

The administrator must be able to answer:

- Is this ready to use, and when was that last checked?
- Who can use it, and whose account will it act through?
- What changes if I continue, including effects on existing assistants?
- If something stops halfway, what has already happened and what can I safely do next?

## Evidence boundary

The OpenCrane assessment is pinned to `967f7c0b6` on `feat/library-component-decomposition`. Later branches may contain additional work; reconcile this inventory against the implementation branch before estimating or building. Existing unrelated workspace changes were not used as the screenshot source.

| Capability | Observed foundation | Design and implementation gap |
| --- | --- | --- |
| Provider keys | Admin form; write-only add, replace and remove; status; durable backend commands | Browser recovery must retain and resume the exact admitted change. Saved credentials must be distinguished from a verified working connection. |
| Models | Registration and routing-default APIs; provider model seeding | Model selection/testing and lifecycle UI; update/unregister backend contracts are absent in this snapshot. |
| MCP | Catalogue, install/uninstall, governance; remote registration and OCI validation/promotion APIs | New-connection setup, personal credentials/OAuth, connection tests and a complete update lifecycle. |
| Members | Directory, invitation roles, batches, shareable links and verified-email acceptance | Existing-member role changes, removal/suspension and invitation revocation require new backend capabilities. |
| Groups/access | Group and membership APIs; central authorization | A usable group/access administration surface and understandable effective-access summaries. |

Source anchors: [provider contract](../../../libs/backend/server/gateways/providers/main/README.md), [key gateway](../../../libs/frontend/state/provider-key/adapter/src/lib/opencrane-provider-key-gateway.ts), [MCP gateway](../../../libs/frontend/state/mcp/adapter/src/lib/opencrane-mcp-gateway.ts), [member routes](../../../libs/backend/server/iam/organization-members/main/src/organization-members.router.ts), [group routes](../../../libs/backend/server/iam/groups/main/src/routes/groups.ts).

## Scope and navigation

Proposed information architecture under **Organisation settings**:

| Destination | Primary task |
| --- | --- |
| Overview | See missing setup and problems that need attention; continue an interrupted task. |
| Models & providers | Connect a provider, select models, set defaults, test and maintain access. |
| Integrations | Add a company tool, connect accounts, choose access, test and maintain its version. |
| People & groups | Invite people, manage membership and groups, review and remove access. |
| Change history | Understand who changed configuration, the outcome and any unfinished work. |

This consolidates the current `/admin/model-keys`, `/admin/catalogue` and `/settings/members` entry points conceptually. Route migration is an implementation decision. Keep employee **My tools** separate from organisation administration; personal connection actions can link into their own account flow.

The overview is a task list, not a dashboard of invented health scores. Show concrete items such as “Choose a default model”, “Odoo needs reconnection” or “Invitation delivery unavailable”. Hide destinations the person cannot discover. Where they can view but cannot change a resource, explain the required role and offer a legitimate request/help path.

Out of scope: cluster operations, self-hosted model-weight deployment, a public extension marketplace, a new policy engine, changing assistant execution semantics, or claiming completion of the model-to-tool conversation loop.

## Journey 1: models and providers

**Connect → verify → choose models → set access/default → maintain.**

1. Choose a supported provider. Explain whether the connection is organisation-managed and what data goes to the provider.
2. Enter a write-only API key. Show a meaningful connection name, owner and last-change metadata; never show a saved key or persist a draft in browser storage.
3. Save and verify. Treat credential custody, provider reachability and a successful model test as different evidence. A test request must explain any provider charge before execution and have a bounded backend operation.
4. Select available models and an organisation default. Clearly distinguish registering a hosted model from deploying a model. If discovery is unavailable, provide a validated manual model identifier path.
5. Review who may use the models. Administrative permission does not silently grant every employee usage rights. Display the effective audience and any access still needed.
6. Confirm the model is ready for the intended assistant. Success links to a supported test conversation; if that product journey is unavailable, say so instead of presenting a false success.

The detail view supports testing, replacing the key, adjusting model/default selection and retiring a connection. Before retirement, show dependent defaults and assistants, choose replacements where required and explain effects on active versus future work. The backend decides those effects; the UI cannot promise uninterrupted execution or rollback without a contract.

**Recovery requirement:** preserve the server-issued command identity for every admitted change. After timeout or reload, reconcile its status before offering another write. If the exact change needs the key again, request re-entry with clear copy; do not store the raw key for retries. “Retry” must not create a competing change.

Suggested copy: “Key saved. Connection verification is still pending.” / “We could not confirm the change. Check status before trying again.”

## Journey 2: company integrations

**Choose/add → configure → connect → review access → test → enable → update or retire.**

1. Choose a catalogue integration or add a supported remote/packaged MCP integration. Use business descriptions first; expose protocol/package details in an advanced section when relevant.
2. Show publisher, source, installed version and requested capabilities. Configuration fields should explain the business meaning of each input.
3. Make account ownership explicit: a company service account versus each employee's own account. An admin installation must never imply that personal OAuth consent has happened.
4. Complete credentials/OAuth with cancel, expired authorization and reconnect states. Never expose raw credentials in status, URLs, logs or screenshots.
5. Select people/groups and proposed action restrictions. Candidate presets such as “Read only” and “Ask before changes” must map to actual server-supported tool/action grants and approvals. They cannot be decorative toggles or a parallel policy language.
6. Run a bounded connection check. Default to a safe read/discovery operation; identify any test that would change external data before execution.
7. Enable only after the server confirms the required checks. Show **Installed**, **Connected**, **Allowed for these people**, and **Available to the assistant** as separate facts; do not compress them into a misleading green dot.

An update review compares current and proposed versions, tools, permissions and setup requirements. Preserve the old working version until a server-supported transition succeeds. New access requires an explicit review. Provide resume/cancel/failure states, and show rollback only when the backend can safely restore the selected version and configuration. Initial installation is not evidence that upgrade or rollback already exists.

Removal must explain affected users and assistants, shared versus personal credentials, and what remains in history. Do not erase audit history or imply that removing an integration automatically deletes the external account.

## Journey 3: people and groups

**Invite → join → assign access → change responsibility → remove access.**

1. Invite one or several people with a clear role and proposed group membership. Review recipients and access before submission.
2. Show delivery truthfully: “Invitation link created” differs from “Email sent”. The current backend returns links. Design delivery failure, expired invite, wrong signed-in account, resend and proposed revoke states.
3. A member detail view shows status, role, groups and effective access with its source. Keep role changes separate from profile edits.
4. Group membership changes preview the resources affected. Identity-provider-managed groups are read-only here, with a clear owner and next step.
5. Removal/suspension explains access loss and the handling of owned resources. Protect the last administrator and self-removal through backend rules. Suspension/reactivation and ownership transfer are proposed capabilities requiring explicit contracts.
6. On reactivation or reinvitation, do not silently restore revoked grants. Show the current access that would apply.

Standalone OpenCrane and Fleet-managed membership need visibly different management ownership where applicable. If the remote authority is unavailable, retain a truthful unavailable state; do not offer a local fallback that changes authority.

## Shared state and interaction contract

These are design states, not new backend enums. Map each to verified server evidence.

| State | What the person needs | Expected interaction |
| --- | --- | --- |
| Not configured | What is missing and who can do it | Start setup |
| Draft | What is saved; what remains local | Continue; warn before discarding unsaved non-secret work |
| Applying/checking | Which step is underway | Reconcile status; avoid duplicate submission |
| Needs input | Exact missing credential, consent or choice | Continue the existing operation |
| Ready | Scope and last successful verification | Use, test or manage |
| Failed, safe to retry | Plain reason and whether anything changed | Retry the exact operation |
| Outcome unknown | The system cannot yet confirm the effect | Check status; do not claim success or repeat the write |
| Access changed | The operation is no longer permitted | Clear protected state; explain the next legitimate step |
| Disabled/removed | What stopped and what history remains | Restore only when supported; otherwise start a new authorized setup |

Keep affected rows usable independently during other saves. Show field validation near inputs, operation status near the affected resource, and success after authoritative confirmation. Never replace a previous successful value optimistically when the new operation is uncertain.

Use plain labels such as “Connection needs verification” instead of “Secret-only”, and “Connect account” beside “Needs connection”. Infrastructure identifiers belong in optional support details, with a copyable non-secret reference.

## Visual and component direction

Keep OpenCrane's existing light surfaces, cyan accent, typography, section headings and table/list vocabulary. The member directory is a useful positive reference. The narrow tool rows expose problems to fix: tiny status vocabulary, adjacent actions and incomplete recovery paths.

Reuse the existing settings shell, member directory/invitation components, model-key row, catalogue card, installed-tool row and governance row. Compose setup journeys with existing journey/progress, heading, scope and resource-feedback elements. Extend their state contracts before inventing parallel cards or status systems. The [component handoff](components.md) records implementation ownership and required new states.

Desktop and 390px mobile designs must preserve names, state, ownership and the primary action. Use labels/icons in addition to colour; support keyboard-only operation, visible focus, modal focus return, error summaries and live progress announcements. Long names and translated copy must not overlap controls.

Borrow OC8's clarity and coherent setup concept, not its visual branding or its in-process extension trust model. Explain **what this connection can do**, **who can use it**, and **what happens next** before technical details.

## Designer deliverables and acceptance

Deliver an annotated navigation map, desktop/mobile list and detail screens for all three journeys, clickable setup flows, an update comparison, access-change confirmations and the complete shared state matrix. Separate screens supported today from screens blocked on backend work.

Use the following as proposed usability acceptance tasks, not measured results:

- Three representative non-engineer administrators can configure a provider/model, connect an integration and invite a colleague without a terminal or facilitator intervention.
- Each can explain who has access and which account an integration uses before enabling it.
- Each can recover a simulated interrupted key change without creating a duplicate operation or revealing a secret.
- Each can distinguish “installed” from “connected and available”, review an update's additional access, and identify affected resources before removal.
- Each can remove a member's access and understand the outcome without promising deletion of historical work.
- All critical flows work with keyboard navigation and at 390px width; permission loss and reload are represented in the prototype.

Implementation acceptance additionally needs API tests for exact retry identity, current authorization, dependency impact and negative cases, plus authenticated end-to-end checks for each complete journey. Screenshot approval alone is insufficient.

## Sequencing and decisions

1. First design the shared navigation, state vocabulary and provider recovery flow; this builds on existing capabilities.
2. Design member administration and integration credentials alongside their missing API contracts.
3. Deliver model retirement and integration update/rollback only with dependency, version and recovery semantics in place.

Resolve before implementation: who may manage each connection; which integrations support personal versus shared accounts; supported permission presets; treatment of active work during revocation/removal; update/rollback guarantees; identity-provider and Fleet handoffs; and whether invitation email delivery is included. None is settled merely by a prototype.

## OC8 references

Reviewed OC8 revision: `314c6842acdc7e53a1f485b91e306dfa45c82937`. References illustrate patterns, not acceptance proof for OpenCrane:

- [Architecture](https://github.com/oc8-ai/oc8/blob/314c6842acdc7e53a1f485b91e306dfa45c82937/ARCHITECTURE.md): overview first, ownership next, then one execution flow.
- [Model management](https://github.com/oc8-ai/oc8/blob/314c6842acdc7e53a1f485b91e306dfa45c82937/frontend/src/routes/models.tsx): discover, configure, test and maintain models.
- [Extension contract](https://github.com/oc8-ai/oc8/blob/314c6842acdc7e53a1f485b91e306dfa45c82937/capas/README.md): related setup fields, credentials and permission presets.
- [Extension UI](https://github.com/oc8-ai/oc8/blob/314c6842acdc7e53a1f485b91e306dfa45c82937/frontend/src/routes/capas.tsx): setup and renewed consent states.

No OC8 product-interface screenshots are included: its application was not run during this brief. The one OC8 capture is explicitly a public architecture-document excerpt.
