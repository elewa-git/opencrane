import { componentWrapperDecorator, type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { GovernanceReadStates } from "../../../reporting/reporting-view.types";
import { AuditResultsComponent } from "../audit-results.component";

/** Defines the component catalogue with the Settings paper surface and shared token spacing. */
const meta: Meta<AuditResultsComponent> = {
	title: "Governance/Audit", component: AuditResultsComponent, tags: ["autodocs"],
	decorators: [componentWrapperDecorator(function _wrap(story) { return `<div style="display:grid;padding:var(--oc-space-4);background:var(--oc-surface-paper)">${story}</div>`; })],
	parameters: { docs: { description: { component: "Returned audit rows and read intents. The API owns permission filtering and persisted audit capture." } } },
	args: { feedback: { state: GovernanceReadStates.Ready, error: null }, rows: [{ id: "event-1", timestamp: "22 Sep 2026, 10:00 UTC", action: "run.read", resource: "run-inventory-017", message: "Requested inventory analysis history." }], hasMore: false, loadingMore: false, loadMoreError: null }
};
export default meta;

/** Session loss hides stale audit data and explains sign-in recovery without navigating or granting access. */
export const Unauthenticated: StoryObj<AuditResultsComponent> = { tags: ["visual-test"], args: { feedback: { state: GovernanceReadStates.Unauthenticated, error: null } }, parameters: { docs: { description: { story: "Session loss hides supplied audit rows and explains sign-in recovery. The app owns authentication and navigation." } } } };

/** Names the local component story contract. */
type Story = StoryObj<AuditResultsComponent>;

/** A populated returned page verifies readable event columns without claiming every event is visible. */
export const Ready: Story = { tags: ["visual-test"], parameters: { docs: { description: { story: "A populated returned page verifies readable event columns without claiming every event is visible." } } } };

/** Long localized rows at 390 pixels verify wrapping and reachable overflow without interpreting event text. */
export const LongNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { rows: [{ id: "long", timestamp: "22 Sep 2026, 10:00 UTC", action: "conversation.inventory-analysis.read", resource: "organization-nairobi-warehouse-inventory-analysis-0123456789", message: "Inventariscontrole voor de magazijnen in Nairobi — <script>not executable</script> — long returned text." }] }, parameters: { docs: { description: { story: "Long localized rows at 390 pixels preserve headers and timestamps inside the focusable scroll owner; event prose wraps at words without interpreting it." } } }, play: async function _readableAudit({ canvasElement })
{
	const region = within(canvasElement).getByRole("region", { name: "Visible audit entries" });
	region.focus();
	await expect(region).toHaveFocus();
	await expect(getComputedStyle(region).overflowX).toBe("auto");
	await expect([...region.querySelectorAll("th, tbody td:first-child")].every(cell => getComputedStyle(cell).whiteSpace === "nowrap")).toBe(true);
	for (const copy of canvasElement.querySelectorAll<HTMLElement>("wo-section-heading h2, wo-section-heading p"))
	{
		await expect(copy.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
		await expect(copy.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
		await expect(copy.scrollWidth).toBeLessThanOrEqual(copy.clientWidth);
	}
} };

/** Initial read progress suppresses supplied stale rows; this fixture performs no request. */
export const Loading: Story = { args: { feedback: { state: GovernanceReadStates.Loading, error: null } }, parameters: { docs: { description: { story: "Initial read progress suppresses supplied stale rows; this fixture performs no request." } } } };

/** An empty response explains permission filtering without asserting no audit records exist. */
export const FilteredEmpty: Story = { tags: ["visual-test"], args: { rows: [] }, parameters: { docs: { description: { story: "An empty response explains permission filtering without asserting no audit records exist." } } } };

/** An empty filtered page still offers continuation; the component never invents a cursor. */
export const EmptyWithMore: Story = { tags: ["visual-test"], args: { rows: [], hasMore: true }, parameters: { docs: { description: { story: "An empty filtered page still offers continuation; the component never invents a cursor." } } } };

/** Retained rows stay visible during refresh while duplicate refresh controls are disabled. */
export const Refreshing: Story = { args: { feedback: { state: GovernanceReadStates.Refreshing, error: null } }, parameters: { docs: { description: { story: "Retained rows stay visible during refresh while duplicate refresh controls are disabled." } } } };

/** Failed refresh labels retained entries as stale and offers a read retry, not new authority. */
export const RetainedError: Story = { tags: ["visual-test"], args: { feedback: { state: GovernanceReadStates.RetainedError, error: "Audit could not be refreshed." } }, parameters: { docs: { description: { story: "Failed refresh labels retained entries as stale and offers a read retry, not new authority." } } } };

/** Denial suppresses deliberately supplied stale rows and continuation without selecting a role policy. */
export const Forbidden: Story = { tags: ["visual-test"], args: { feedback: { state: GovernanceReadStates.Forbidden, error: null }, hasMore: true }, parameters: { docs: { description: { story: "Denial suppresses deliberately supplied stale rows and continuation without selecting a role policy." } } } };

/** Initial failure offers read retry without presenting supplied old data as usable. */
export const Unavailable: Story = { args: { feedback: { state: GovernanceReadStates.Unavailable, error: null } }, parameters: { docs: { description: { story: "Initial failure offers read retry without presenting supplied old data as usable." } } } };

/** Pending continuation preserves earlier rows and disables duplicate read intents; the store owns admission. */
export const LoadingMore: Story = { args: { hasMore: true, loadingMore: true }, parameters: { docs: { description: { story: "Pending continuation preserves earlier rows and disables duplicate read intents; the store owns admission." } } } };

/** A next-page failure preserves earlier rows and offers continuation without resetting the audit read. */
export const ContinuationError: Story = { tags: ["visual-test"], args: { hasMore: true, loadMoreError: "The next page could not be loaded. Try Load more again." }, parameters: { docs: { description: { story: "A next-page failure preserves earlier rows and offers continuation without resetting the audit read." } } } };

/** Proves an empty-page continuation emits an intent without invoking the API. */
export const LoadMoreIntent: Story = { args: { rows: [], hasMore: true }, parameters: { docs: { description: { story: "The real Load more control emits once for an empty filtered page. The state owner performs the read." } } }, render: function _render(args)
{
	return { props: { ...args, moreCount: 0 }, template: '<wo-audit-results [feedback]="feedback" [rows]="rows" [hasMore]="hasMore" [loadingMore]="loadingMore" [loadMoreError]="loadMoreError" (loadMoreRequested)="moreCount = moreCount + 1" /><output data-testid="more-intent" [attr.data-count]="moreCount"></output>' };
}, play: async function _loadMore({ canvasElement })
{
	const canvas = within(canvasElement);
	await expect(canvas.getByTestId("more-intent")).toHaveAttribute("data-count", "0");
	await userEvent.click(canvas.getByRole("button", { name: "Load more audit entries" }));
	await expect(canvas.getByTestId("more-intent")).toHaveAttribute("data-count", "1");
} };
