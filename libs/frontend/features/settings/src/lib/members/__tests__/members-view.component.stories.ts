import type { Meta, StoryObj } from "@storybook/angular";

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
		{ id: "member-1", kind: MemberDirectoryRowKinds.Member, initials: "JR", name: "Jente Rosseel", email: "jente@example.com", roleLabel: "Owner", roleTone: ScopeChipTones.Warning, detail: "Active member", isCurrentUser: true, canResend: false, resending: false },
		{ id: "member-2", kind: MemberDirectoryRowKinds.Member, initials: "AK", name: "Alex Kim", email: "alex@example.com", roleLabel: "Member", roleTone: ScopeChipTones.Neutral, detail: "Active member", isCurrentUser: false, canResend: false, resending: false }
	],
	pendingRows: [{ id: "invite-1", kind: MemberDirectoryRowKinds.Invitation, initials: "W", name: "wanjiru@example.com", email: "wanjiru@example.com", roleLabel: "Pending", roleTone: ScopeChipTones.Warning, detail: "Invited Aug 17, 2026 · expires Aug 24, 2026", isCurrentUser: false, canResend: true, resending: false }],
	searchQuery: "",
	refreshError: null,
	inviteState: OrganizationInviteCommandStates.Editing,
	inviteIssues: [],
	inviteError: null,
	inviteLinks: [],
	resentInviteLink: null,
	resendError: null
};

/** Desktop member-directory baseline. */
export const Ready: Story = { tags: ["visual-test"], args: { view: READY }, parameters: { docs: { description: { story: "The ordinary authorized directory. It protects page hierarchy, active/pending navigation, row density, and search layout while granting no invitation authority." } } } };

/** Narrow layout keeps navigation, search, and rows usable at 390 pixels. */
export const ReadyNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { view: READY }, parameters: { docs: { description: { story: "The supported mobile-width directory. It verifies that controls remain reachable and identity text wraps without hiding status meaning." } } } };
