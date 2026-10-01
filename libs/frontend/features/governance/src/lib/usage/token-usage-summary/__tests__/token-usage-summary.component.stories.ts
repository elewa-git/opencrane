import { componentWrapperDecorator, type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { GovernanceReadStates } from "../../../reporting/reporting-view.types";
import { TokenUsageSummaryComponent } from "../token-usage-summary.component";

/** Defines the component catalogue with the Settings paper surface and shared token spacing. */
const meta: Meta<TokenUsageSummaryComponent> = {
	title: "Governance/Recorded usage", component: TokenUsageSummaryComponent, tags: ["autodocs"],
	decorators: [componentWrapperDecorator(function _wrap(story) { return `<div style="display:grid;padding:var(--oc-space-4);background:var(--oc-surface-paper)">${story}</div>`; })],
	parameters: { docs: { description: { component: "Recorded account usage returned by the API. These display fixtures do not prove sampling, billing completeness or enforcement." } } },
	args: { feedback: { state: GovernanceReadStates.Ready, error: null }, rows: [{ id: "usd", userId: "account-warehouse-analysis", currency: "USD", inputTokens: "12,000", outputTokens: "3,200", totalTokens: "15,200", totalCost: "0.74", budgetCeiling: "10.00" }, { id: "kes", userId: "account-operations", currency: "KES", inputTokens: "0", outputTokens: null, totalTokens: null, totalCost: null, budgetCeiling: null }] }
};
export default meta;

/** Session loss hides recorded usage and asks the user to sign in without inventing a new session. */
export const Unauthenticated: StoryObj<TokenUsageSummaryComponent> = { tags: ["visual-test"], args: { feedback: { state: GovernanceReadStates.Unauthenticated, error: null } }, parameters: { docs: { description: { story: "Session loss hides supplied usage rows and explains sign-in recovery. Authentication remains outside the component." } } } };

/** Names the local component story contract. */
type Story = StoryObj<TokenUsageSummaryComponent>;

/** Rows in two currencies remain separate and unknown is distinct from zero; no spending aggregate is computed. */
export const Ready: Story = { tags: ["visual-test"], parameters: { docs: { description: { story: "Rows in two currencies remain separate and unknown is distinct from zero; no spending aggregate is computed." } } } };

/** Long account names and large returned values at 390 pixels remain reachable without currency conversion. */
export const LongNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { rows: [{ id: "long", userId: "account-nairobi-warehouse-procurement-analysis-0123456789", currency: "KES", inputTokens: "1,234,567,890", outputTokens: "999,999", totalTokens: "1,235,567,889", totalCost: "123,456.78", budgetCeiling: null }] }, parameters: { docs: { description: { story: "Long accounts and large values at 390 pixels remain intact inside the focusable scroll owner without currency conversion." } } }, play: async function _readableUsage({ canvasElement })
{
	const region = within(canvasElement).getByRole("region", { name: "Recorded usage by account and currency" });
	region.focus();
	await expect(region).toHaveFocus();
	await expect(getComputedStyle(region).overflowX).toBe("auto");
	await expect([...region.querySelectorAll("th, tbody td")].every(cell => getComputedStyle(cell).whiteSpace === "nowrap")).toBe(true);
	for (const copy of canvasElement.querySelectorAll<HTMLElement>("wo-section-heading h2, wo-section-heading p"))
	{
		await expect(copy.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
		await expect(copy.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
		await expect(copy.scrollWidth).toBeLessThanOrEqual(copy.clientWidth);
	}
} };

/** Initial usage loading suppresses supplied rows without performing a request. */
export const Loading: Story = { args: { feedback: { state: GovernanceReadStates.Loading, error: null } }, parameters: { docs: { description: { story: "Initial usage loading suppresses supplied rows without performing a request." } } } };

/** Absent or filtered records are not presented as zero spending. */
export const FilteredEmpty: Story = { tags: ["visual-test"], args: { rows: [] }, parameters: { docs: { description: { story: "Absent or filtered records are not presented as zero spending." } } } };

/** Pending refresh retains rows with disabled controls, not fresh billing evidence. */
export const Refreshing: Story = { args: { feedback: { state: GovernanceReadStates.Refreshing, error: null } }, parameters: { docs: { description: { story: "Pending refresh retains rows with disabled controls, not fresh billing evidence." } } } };

/** Read failure keeps old amounts visibly stale and offers a read retry without changing values. */
export const RetainedError: Story = { tags: ["visual-test"], args: { feedback: { state: GovernanceReadStates.RetainedError, error: null } }, parameters: { docs: { description: { story: "Read failure keeps old amounts visibly stale and offers a read retry without changing values." } } } };

/** A denied read hides supplied private rows; this fixture does not define role permissions. */
export const Forbidden: Story = { tags: ["visual-test"], args: { feedback: { state: GovernanceReadStates.Forbidden, error: null } }, parameters: { docs: { description: { story: "A denied read hides supplied private rows; this fixture does not define role permissions." } } } };

/** An unavailable response is not replaced with a fabricated empty or zero report. */
export const Unavailable: Story = { args: { feedback: { state: GovernanceReadStates.Unavailable, error: null } }, parameters: { docs: { description: { story: "An unavailable response is not replaced with a fabricated empty or zero report." } } } };

/** Proves the refresh intent without a network call. */
export const RefreshIntent: Story = { parameters: { docs: { description: { story: "The refresh control emits a read intent while authorization and request admission remain with the state owner." } } }, render: function _render(args)
{
	return { props: { ...args, refreshCount: 0 }, template: '<wo-token-usage-summary [feedback]="feedback" [rows]="rows" (refreshRequested)="refreshCount = refreshCount + 1" /><output data-testid="refresh-intent" [attr.data-count]="refreshCount"></output>' };
}, play: async function _refresh({ canvasElement })
{
	const canvas = within(canvasElement);
	await expect(canvas.getByTestId("refresh-intent")).toHaveAttribute("data-count", "0");
	await userEvent.click(canvas.getByRole("button", { name: "Refresh recorded usage" }));
	await expect(canvas.getByTestId("refresh-intent")).toHaveAttribute("data-count", "1");
} };
