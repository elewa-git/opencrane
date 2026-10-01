import { componentWrapperDecorator, type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { GovernanceReadStates } from "../../../reporting/reporting-view.types";
import { BudgetSummaryComponent } from "../budget-summary.component";

/** Defines the component catalogue with the Settings paper surface and shared token spacing. */
const meta: Meta<BudgetSummaryComponent> = {
	title: "Governance/Returned budgets", component: BudgetSummaryComponent, tags: ["autodocs"],
	decorators: [componentWrapperDecorator(function _wrap(story) { return `<div style="display:grid;padding:var(--oc-space-4);background:var(--oc-surface-paper)">${story}</div>`; })],
	parameters: { docs: { description: { component: "Independent read-only global and account budget responses. These fixtures do not prove configured policy or enforcement." } } },
	args: { globalFeedback: { state: GovernanceReadStates.Ready, error: null }, accountsFeedback: { state: GovernanceReadStates.Ready, error: null }, globalBudget: "USD 0", overrides: [{ id: "account-1", userId: "account-warehouse-analysis", budget: "KES 5,000" }] }
};
export default meta;

/** Session loss hides both budget responses while authentication remains the application's responsibility. */
export const Unauthenticated: StoryObj<BudgetSummaryComponent> = { tags: ["visual-test"], args: { globalFeedback: { state: GovernanceReadStates.Unauthenticated, error: null }, accountsFeedback: { state: GovernanceReadStates.Unauthenticated, error: null } }, parameters: { docs: { description: { story: "Session loss suppresses both stale budget responses and offers fixed sign-in guidance, not new permission." } } } };

/** Names the local component story contract. */
type Story = StoryObj<BudgetSummaryComponent>;

/** Returned USD zero may be default or configured zero; the view makes no enforcement claim. */
export const ReturnedDefault: Story = { tags: ["visual-test"], parameters: { docs: { description: { story: "Returned USD zero may be default or configured zero; the view makes no enforcement claim." } } } };

/** Long account and budget labels at 390 pixels verify independent usable controls without editing budgets. */
export const LongNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { globalBudget: "KES 1,234,567.89", overrides: [{ id: "long", userId: "account-nairobi-warehouse-procurement-analysis-0123456789", budget: "KES 123,456.78" }] }, parameters: { docs: { description: { story: "Long account and budget values at 390 pixels stay intact inside the focusable scroll owner; controls emit reads without editing budgets." } } }, play: async function _readableBudgets({ canvasElement })
{
	const region = within(canvasElement).getByRole("region", { name: "Account budget rows" });
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

/** Denied global data disappears while independently readable account overrides remain visible. */
export const GlobalDenied: Story = { tags: ["visual-test"], args: { globalFeedback: { state: GovernanceReadStates.Forbidden, error: null } }, parameters: { docs: { description: { story: "Denied global data disappears while independently readable account overrides remain visible." } } } };

/** Denied account overrides disappear without hiding the independently readable global response. */
export const AccountsDenied: Story = { tags: ["visual-test"], args: { accountsFeedback: { state: GovernanceReadStates.Forbidden, error: null } }, parameters: { docs: { description: { story: "Denied account overrides disappear without hiding the independently readable global response." } } } };

/** Unknown global amount and empty overrides do not become fabricated zero limits. */
export const EmptyUnknown: Story = { tags: ["visual-test"], args: { globalBudget: null, overrides: [] }, parameters: { docs: { description: { story: "Unknown global amount and empty overrides do not become fabricated zero limits." } } } };

/** Separate initial reads suppress supplied old values without coupling request lifecycle. */
export const Loading: Story = { args: { globalFeedback: { state: GovernanceReadStates.Loading, error: null }, accountsFeedback: { state: GovernanceReadStates.Loading, error: null } }, parameters: { docs: { description: { story: "Separate initial reads suppress supplied old values without coupling request lifecycle." } } } };

/** A pending global refresh does not disable account refresh; the store owns concurrency. */
export const IndependentRefresh: Story = { args: { globalFeedback: { state: GovernanceReadStates.Refreshing, error: null } }, parameters: { docs: { description: { story: "A pending global refresh does not disable account refresh; the store owns concurrency." } } } };

/** Initial global failure stays separate from stale retained account data and its read retry. */
export const IndependentFailures: Story = { tags: ["visual-test"], args: { globalFeedback: { state: GovernanceReadStates.Unavailable, error: null }, accountsFeedback: { state: GovernanceReadStates.RetainedError, error: null } }, parameters: { docs: { description: { story: "Initial global failure stays separate from stale retained account data and its read retry." } } } };

/** Proves each control emits to its own protected read owner. */
export const IndependentReadIntents: Story = { parameters: { docs: { description: { story: "Separate controls emit independent refresh intents. The component does not fetch, mutate or grant budget access." } } }, render: function _render(args)
{
	return { props: { ...args, globalCount: 0, accountCount: 0 }, template: '<wo-budget-summary [globalFeedback]="globalFeedback" [accountsFeedback]="accountsFeedback" [globalBudget]="globalBudget" [overrides]="overrides" (globalRefreshRequested)="globalCount = globalCount + 1" (accountRefreshRequested)="accountCount = accountCount + 1" /><output data-testid="global-intent" [attr.data-count]="globalCount"></output><output data-testid="account-intent" [attr.data-count]="accountCount"></output>' };
}, play: async function _reads({ canvasElement })
{
	const canvas = within(canvasElement);
	await expect(canvas.getByTestId("global-intent")).toHaveAttribute("data-count", "0");
	await expect(canvas.getByTestId("account-intent")).toHaveAttribute("data-count", "0");
	await userEvent.click(canvas.getByRole("button", { name: "Refresh global budget" }));
	await expect(canvas.getByTestId("global-intent")).toHaveAttribute("data-count", "1");
	await expect(canvas.getByTestId("account-intent")).toHaveAttribute("data-count", "0");
	await userEvent.click(canvas.getByRole("button", { name: "Refresh account budgets" }));
	await expect(canvas.getByTestId("global-intent")).toHaveAttribute("data-count", "1");
	await expect(canvas.getByTestId("account-intent")).toHaveAttribute("data-count", "1");
} };
