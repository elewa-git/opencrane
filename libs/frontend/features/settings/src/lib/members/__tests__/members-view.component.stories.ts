import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ScopeChipTones } from "@opencrane/elements/ui";
import { OrganizationInviteCommandStates, OrganizationMemberDirectoryStates } from "@opencrane/state/organization/members";

import { MembersViewComponent } from "../members-view.component";
import { MemberDirectoryRowKinds, type MembersViewModel } from "../member-directory.types";

/** Storybook catalogue metadata for the settings member directory. */
const meta: Meta<MembersViewComponent> = { title: "Settings/Members", component: MembersViewComponent, tags: ["autodocs"], parameters: { docs: { description: { component: "The presentational settings member screen. Fixtures exercise directory and command states without calling membership authority or deciding who may invite." } } } };
export default meta;

/** Local story type for settings member states. */
type Story = StoryObj<MembersViewComponent>;

/** Ready wide directory with accepted and pending rows. */
const READY: MembersViewModel = {
	directoryState: OrganizationMemberDirectoryStates.Ready,
	activeCount: 2,
	pendingCount: 1,
	activeRows: [
		{ id: "member-1", kind: MemberDirectoryRowKinds.Member, initials: "JR", name: "Jente Rosseel", email: "jente@example.com", roleLabel: "Owner", roleTone: ScopeChipTones.Warning, detail: "Active member", isCurrentUser: true, canResend: false, resending: false, canRemove: false, removing: false, removalDetail: "Owner protected" },
		{ id: "member-2", kind: MemberDirectoryRowKinds.Member, initials: "AK", name: "Alex Kim", email: "alex@example.com", roleLabel: "Member", roleTone: ScopeChipTones.Neutral, detail: "Active member", isCurrentUser: false, canResend: false, resending: false, canRemove: true, removing: false, removalDetail: null }
	],
	pendingRows: [{ id: "invite-1", kind: MemberDirectoryRowKinds.Invitation, initials: "W", name: "wanjiru@example.com", email: "wanjiru@example.com", roleLabel: "Pending", roleTone: ScopeChipTones.Warning, detail: "Invited Aug 17, 2026 · expires Aug 24, 2026", isCurrentUser: false, canResend: true, resending: false, canRemove: false, removing: false, removalDetail: null }],
	searchQuery: "",
	refreshError: null,
	inviteState: OrganizationInviteCommandStates.Editing,
	inviteIssues: [],
	inviteError: null,
	inviteLinks: [],
	resentInviteLink: null,
	resendError: null, removalMessage: null, removalError: null
};

/** Desktop member-directory baseline. */
export const Ready: Story = { tags: ["visual-test"], args: { view: READY }, parameters: { docs: { description: { story: "The ordinary authorized directory. It protects page hierarchy, active/pending navigation, row density, and search layout while granting no invitation authority." } } } };

/** Narrow layout keeps navigation, search, and rows usable at 390 pixels. */
export const ReadyNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { view: READY }, parameters: { docs: { description: { story: "The supported mobile-width directory. It verifies that controls remain reachable and identity text wraps without hiding status meaning." } } } };

/** Shows server-protected status in identity text when the desktop status column is hidden. */
export const ProtectedMembersNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { view: { ...READY, activeRows: [
	READY.activeRows[0]!,
	{ ...READY.activeRows[1]!, id: "removed", name: "Alexandria Wanjiru Njeri Kamau — product and customer operations", canRemove: false, detail: "Membership suspended", removalDetail: "Access removed" },
	{ ...READY.activeRows[1]!, id: "self", canRemove: false, removalDetail: "Your membership" },
	{ ...READY.activeRows[1]!, id: "fleet", canRemove: false, removalDetail: "Removal unavailable" },
	{ ...READY.activeRows[1]!, id: "permission", canRemove: false, removalDetail: "Removal not permitted" }
] } } };

/** Keeps the exact target visibly busy until its command finishes. */
export const Removing: Story = { tags: ["visual-test"], args: { view: { ...READY, activeRows: [READY.activeRows[0]!, { ...READY.activeRows[1]!, removing: true }] } } };

/** Retains the removed membership and its conversation attribution after a successful response. */
export const AccessRemoved: Story = { tags: ["visual-test"], args: { view: { ...READY, activeCount: 1, activeRows: [READY.activeRows[0]!, { ...READY.activeRows[1]!, canRemove: false, detail: "Membership suspended", removalDetail: "Access removed" }], removalMessage: "Organization access removed. Existing conversation records are retained." } } };

/** Reports an uncertain outcome without claiming the membership was changed. */
export const RemovalUnconfirmed: Story = { tags: ["visual-test"], args: { view: { ...READY, removalError: "Removal could not be confirmed. Refresh to check access, or retry this member." } } };

/** A proven denial suppresses even accidentally supplied stale rows and links in the presentation. */
export const AccessDenied: Story = { tags: ["visual-test"], args: { view: { ...READY, directoryState: OrganizationMemberDirectoryStates.Forbidden, activeCount: 0, pendingCount: 0, activeRows: [], pendingRows: [], inviteLinks: ["private-stale-link"], resentInviteLink: "private-stale-link" } }, play: async function _Denied({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(canvas.queryByRole("button", { name: "Invite people" })).not.toBeInTheDocument();
	expect(canvas.queryByText("private-stale-link")).not.toBeInTheDocument();
	expect(canvas.queryByRole("table")).not.toBeInTheDocument();
} };

/** Exercises native dialog focus, cancellation and one exact accepted intent against the real components. */
export const RemovalConfirmation: Story = { args: { view: READY }, render: function _Render(args)
{
	return { props: { ...args, removedId: "", removalCount: 0 }, template: `<wo-members-view [view]="view" (removalRequested)="removedId = $event; removalCount = removalCount + 1" /><output data-testid="removal-result" [attr.data-id]="removedId" [attr.data-count]="removalCount"></output>` };
}, play: async function _Confirm({ canvasElement })
{
	const canvas = within(canvasElement);
	const page = within(canvasElement.ownerDocument.body);
	const trigger = canvas.getByRole("button", { name: "Remove organization access for Alex Kim" });
	expect(page.queryByRole("alertdialog")).not.toBeInTheDocument();
	await userEvent.click(trigger);
	let dialog = await page.findByRole("alertdialog", { name: "Remove access" });
	expect(page.getAllByRole("alertdialog")).toHaveLength(1);
	const cancel = within(dialog).getByRole("button", { name: "Cancel" });
	await waitFor(() => { expect(cancel).toHaveFocus(); });
	await userEvent.tab();
	expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true);
	await userEvent.click(cancel);
	await waitFor(() => { expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(); });
	expect(canvas.getByTestId("removal-result")).toHaveAttribute("data-count", "0");
	await waitFor(() => { expect(trigger).toHaveFocus(); });
	await userEvent.click(trigger);
	await page.findByRole("alertdialog", { name: "Remove access" });
	await userEvent.keyboard("{Escape}");
	await waitFor(() => { expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(); });
	expect(canvas.getByTestId("removal-result")).toHaveAttribute("data-count", "0");
	await waitFor(() => { expect(trigger).toHaveFocus(); });
	await userEvent.click(trigger);
	dialog = await page.findByRole("alertdialog", { name: "Remove access" });
	await userEvent.click(within(dialog).getByRole("button", { name: "Cancel removal" }));
	await waitFor(() => { expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(); });
	expect(canvas.getByTestId("removal-result")).toHaveAttribute("data-count", "0");
	await waitFor(() => { expect(trigger).toHaveFocus(); });
	await userEvent.click(trigger);
	dialog = await page.findByRole("alertdialog", { name: "Remove access" });
	await userEvent.click(within(dialog).getByRole("button", { name: "Remove access" }));
	expect(canvas.getByTestId("removal-result")).toHaveAttribute("data-count", "1");
	expect(canvas.getByTestId("removal-result")).toHaveAttribute("data-id", "member-2");
	await waitFor(() => { expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(); });
} };
