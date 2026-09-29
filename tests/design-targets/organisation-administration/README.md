# Organisation administration design targets

These 36 PNGs are the user-supplied implementation targets from `OpenCrane Frontend Wireframes-.zip`, imported on 25 September 2026. Original bytes and filenames are preserved. [manifest.json](manifest.json) records the source archive checksum and each image's checksum and dimensions.

Read the [design brief](../../../docs/design/administration-lifecycle/README.md) and [component guidance](../../../docs/design/administration-lifecycle/components.md) alongside these targets.

## How implementing agents should use these targets

1. Open the relevant desktop and narrow target before implementing a journey. Match its layout, information hierarchy, states and recovery actions using the existing component catalogue.
2. Treat export captions and annotations as design context outside the product viewport. Export pixel dimensions are not browser viewport dimensions; `390` in a filename identifies a narrow design frame inside a larger export.
3. Add or extend deterministic Storybook states and interaction tests for the implemented journey. Include loading, empty, denied, failure, saving, unknown outcome and recovery where applicable, plus keyboard and focus behaviour.
4. Compare actual rendered output with the appropriate target, recording intentional differences. Use the existing [Storybook visual suite](../../storybook/storybook.visual.spec.ts) to capture reviewed implementation baselines. These references are not automatically consumed by that suite and must not be copied into its baseline directory to make tests pass.
5. Resolve the contract corrections below before treating screen copy as an implementation requirement. The PNGs express design intent; they do not prove backend support or authorize new permission rules.

## Corrections and missing coverage

- **1k, system explainer:** describe durable conversation-owned workspaces and replaceable compute. Do not promise that every run discards its workspace.
- **Skills and scheduled workflows:** distinguish requester, owner and executing identity; managed agents use their own granted authority. Keep this follow-up scope explicit alongside the three primary administration journeys.
- **Invitations, removal and updates:** confirm group assignment, last-owner protection, revocation timing, transfer, notifications and update continuity against the implementation contracts. The prototype's support labels and promises require verification.
- **Groups and change history:** add group/department management, membership and effective-access journeys, external authority/unavailable states, and change-history list/detail targets; these exports do not cover them fully.
- **Responsive and interactive states:** complete narrow integration journeys, retain resource names and connection ownership on member detail, and verify accessible controls, focus, validation, OAuth cancellation/expiry and unknown-outcome recovery in the implemented UI.
- **Fixture consistency:** bind model choices to the selected provider, deduplicate overlapping group counts, and reconcile overview badges with the displayed tasks. The overview export shows four tasks but a badge of three; its profile text also overlaps. These are defects to correct, not visual requirements.

## Image index

Open a link to inspect the full-resolution target. Frame IDs preserve the supplied export order, including the skills/workflows section preceding the state vocabulary.

| Frame | Target | Export size |
| --- | --- | --- |
| 1a | [member directory](01-1a-member-directory.png) | 2350 × 1610 |
| 1b | [member directory 390](01-1b-member-directory-390.png) | 1640 × 1948 |
| 1c | [provider not connected](01-1c-provider-not-connected.png) | 2350 × 720 |
| 1d | [provider key saved](01-1d-provider-key-saved.png) | 2350 × 688 |
| 1e | [provider saving unknown](01-1e-provider-saving-unknown.png) | 2350 × 816 |
| 1f | [catalogue mcp card](01-1f-catalogue-mcp-card.png) | 2350 × 892 |
| 1g | [installed needs connection](01-1g-installed-needs-connection.png) | 2350 × 646 |
| 1h | [governance review](01-1h-governance-review.png) | 2350 × 1038 |
| 1i | [read failure](01-1i-read-failure.png) | 2350 × 854 |
| 1j | [retrying](01-1j-retrying.png) | 2350 × 918 |
| 1k | [system explainer](01-1k-system-explainer.png) | 2350 × 1906 |
| 2a | [navigation map](02-2a-navigation-map.png) | 840 × 1396 |
| 2b | [overview](02-2b-overview.png) | 2350 × 1524 |
| 2c | [overview 390](02-2c-overview-390.png) | 780 × 918 |
| 3a | [providers models](03-3a-providers-models.png) | 2350 × 1386 |
| 3b | [connect provider flow](03-3b-connect-provider-flow.png) | 2350 × 1382 |
| 3c | [retire connection](03-3c-retire-connection.png) | 1520 × 1014 |
| 3d | [provider detail 390](03-3d-provider-detail-390.png) | 780 × 996 |
| 4a | [mcp register](04-4a-mcp-register.png) | 2350 × 1422 |
| 4b | [add mcp source](04-4b-add-mcp-source.png) | 2350 × 1470 |
| 4c | [mcp connection m365](04-4c-mcp-connection-m365.png) | 2350 × 1664 |
| 4d | [mcp tools access odoo](04-4d-mcp-tools-access-odoo.png) | 2350 × 1934 |
| 4e | [mcp server detail](04-4e-mcp-server-detail.png) | 2350 × 1174 |
| 4f | [mcp update comparison](04-4f-mcp-update-comparison.png) | 1520 × 996 |
| 4g | [mcp removal review](04-4g-mcp-removal-review.png) | 1120 × 794 |
| 5a | [member detail](05-5a-member-detail.png) | 2350 × 1404 |
| 5b | [remove access](05-5b-remove-access.png) | 1240 × 970 |
| 5c | [last owner](05-5c-last-owner.png) | 920 × 524 |
| 5d | [invite delivery](05-5d-invite-delivery.png) | 1120 × 1248 |
| 5e | [member detail 390](05-5e-member-detail-390.png) | 780 × 734 |
| 7a | [skills library](06-7a-skills-library.png) | 2350 × 1290 |
| 7b | [skill detail](06-7b-skill-detail.png) | 2350 × 1186 |
| 7c | [share skill](06-7c-share-skill.png) | 1120 × 1230 |
| 7d | [workflow](06-7d-workflow.png) | 2350 × 1254 |
| 7e | [workflow approval 390](06-7e-workflow-approval-390.png) | 780 × 888 |
| 6a | [state vocabulary](07-6a-state-vocabulary.png) | 2350 × 1166 |
