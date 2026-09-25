import type { Meta, StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";

import { ScopeChipTones } from "@opencrane/elements/ui";
import { ToolApprovalScopeReadStates } from "@opencrane/state/conversation/elicitation";

import { ToolApprovalScopeViewComponent } from "../tool-approval-scopes/tool-approval-scope-view.component";
import type { ToolApprovalScopeRowView, ToolApprovalScopeViewModel } from "../tool-approval-scopes/tool-approval-scope-view.types";

/** Active standing approval with no private arguments or credential coordinates. */
const _ACTIVE: ToolApprovalScopeRowView = { id: "scope-1", action: "Create calendar event", target: "Nairobi operations calendar", externalSystem: "Company calendar", assistantLabel: "Operations assistant", connectionOwnerLabel: "Personal connection: Amina", createdAtLabel: "25 Sept 2026, 10:00", stateLabel: "Active", stateTone: ScopeChipTones.Success, canRevoke: true, busy: false, error: null, revokedNow: false };
/** Ready list used by the interactive and narrow stories. */
const _READY: ToolApprovalScopeViewModel = { readState: ToolApprovalScopeReadStates.Ready, error: null, rows: [_ACTIVE, { ..._ACTIVE, id: "scope-2", action: "Send supplier update", target: "Acacia Supplies", stateLabel: "Revoked", stateTone: ScopeChipTones.Neutral, canRevoke: false, revokedAtLabel: "25 Sept 2026, 11:00" }], hasMore: true };

/** Storybook catalogue for requester-owned standing approval settings states. */
const meta: Meta<ToolApprovalScopeViewComponent> = { title: "Settings/Standing approvals", component: ToolApprovalScopeViewComponent, tags: ["autodocs", "standing-approval"], argTypes: { refreshRequested: { action: "refreshRequested" }, loadMoreRequested: { action: "loadMoreRequested" }, revokeRequested: { action: "revokeRequested" } }, parameters: { docs: { description: { component: "Safe requester-owned summaries and explicit revocation confirmation. Stories are synthetic component evidence, not live authority or accepted screenshot baselines." } } } };
export default meta;

/** Local story type. */
type Story = StoryObj<ToolApprovalScopeViewComponent>;

/** Ready paginated list with an explicit destructive confirmation. */
export const Ready: Story = { args: { view: _READY, revokeRequested: fn(), loadMoreRequested: fn() }, play: async function _Ready({ canvasElement, args })
{
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button", { name: "Revoke" }));
	const page = within(canvasElement.ownerDocument.body);
	const dialog = await page.findByRole("alertdialog");
	expect(dialog).toHaveTextContent(/Future matching actions will need a new approval/u);
	expect(args.revokeRequested).not.toHaveBeenCalled();
	await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
	expect(args.loadMoreRequested).toHaveBeenCalledOnce();
} };

/** First-page loading keeps private rows absent. */
export const Loading: Story = { args: { view: { readState: ToolApprovalScopeReadStates.Loading, error: null, rows: [], hasMore: false } } };
/** Authoritative empty state explains that future actions ask again. */
export const Empty: Story = { args: { view: { readState: ToolApprovalScopeReadStates.Ready, error: null, rows: [], hasMore: false } } };
/** Read failure offers a read retry, never an automatic write retry. */
export const Failure: Story = { args: { view: { readState: ToolApprovalScopeReadStates.Unavailable, error: "Standing approvals could not be loaded. Try again.", rows: [], hasMore: false } } };
/** One row is independently busy while other rows remain readable. */
export const Revoking: Story = { args: { view: { ..._READY, rows: [{ ..._ACTIVE, busy: true }, _READY.rows[1]] } } };
/** Uncertain delivery retains a same-command retry affordance without claiming revocation. */
export const Uncertain: Story = { args: { view: { ..._READY, rows: [{ ..._ACTIVE, error: "OpenCrane could not confirm whether this approval was revoked. Try again to safely repeat the same request." }] } } };
/** Authoritative returned state reports revocation without hiding the historical safe summary. */
export const Revoked: Story = { args: { view: { ..._READY, rows: [{ ..._ACTIVE, stateLabel: "Revoked", stateTone: ScopeChipTones.Neutral, canRevoke: false, revokedNow: true, revokedAtLabel: "25 Sept 2026, 11:00" }] } } };
