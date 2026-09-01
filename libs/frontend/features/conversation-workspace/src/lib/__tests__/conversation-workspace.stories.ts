import { type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { ConversationSessionRailIconStates, ConversationSessionRailItemKinds, type ConversationRailIdentityPresentation, type ConversationSessionRailItemPresentation } from "../conversation-workspace-feature.types";
import { ConversationListComponent } from "../components/conversation-list/conversation-list.component";

/** Provides privacy-safe rows for the desktop and compact visual contracts. */
const _ITEMS: readonly ConversationSessionRailItemPresentation[] =
[
	{ key: "onboarding:onboarding-1", kind: ConversationSessionRailItemKinds.Onboarding, conversationId: null, title: "Welcome", iconState: ConversationSessionRailIconStates.Completed, archived: false },
	{
		key: "agent-session",
		kind: ConversationSessionRailItemKinds.Conversation,
		conversationId: "agent-session",
		title: "The Commander (Guardian)",
		iconState: ConversationSessionRailIconStates.AgentSession,
		archived: false
	},
	{ key: "direct", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "direct", title: "Direct conversation", iconState: ConversationSessionRailIconStates.Direct, archived: false },
	{ key: "group", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "group", title: "Group conversation with the launch planning team", iconState: ConversationSessionRailIconStates.Group, archived: false },
	{ key: "closed", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "closed", title: "Closed handoff", iconState: ConversationSessionRailIconStates.Closed, archived: false },
	{ key: "archived", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "archived", title: "Project handoff", iconState: ConversationSessionRailIconStates.Group, archived: true }
];

/** Provides the generic directory-derived self label used by the rail catalogue. */
const _IDENTITY: ConversationRailIdentityPresentation = { name: "You", detail: "Private workspace", initials: "Y" };

/** Defines the visual-test catalogue for the workspace session rail. */
const meta: Meta<ConversationListComponent> =
{
	title: "Conversations/Workspace",
	component: ConversationListComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [ConversationListComponent] })],
	parameters: { docs: { description: { component: "Private onboarding, direct, group, and Agent-session navigation in one participant-facing My sessions rail." } } }
};

export default meta;
type Story = StoryObj<ConversationListComponent>;

/** Desktop rail shows the completed Welcome session beside ordinary sessions. */
export const DesktopModes: Story = { tags: ["visual-test"], args: { items: _ITEMS, selectedKey: "agent-session", identity: _IDENTITY }, parameters: { viewport: { defaultViewport: "responsive" } } };

/** Compact rail keeps the same unified selection contract. */
export const CompactModes: Story = { tags: ["visual-test", "visual-test-narrow"], args: { items: _ITEMS, selectedKey: "onboarding:onboarding-1", identity: _IDENTITY }, parameters: { viewport: { defaultViewport: "mobile1" } }, play: async function _VerifyCompactRail({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(canvas.getByRole("button", { name: "Welcome, completed" })).toHaveAttribute("aria-current", "page");
	expect(canvasElement.querySelector("nav small")).toBeNull();
	expect(canvasElement.querySelector("nav time")).toBeNull();
} };

/** Empty state gives the participant a clear next action without mentioning missing onboarding history. */
export const Empty: Story = { tags: ["visual-test"], args: { items: [], selectedKey: null, identity: _IDENTITY } };
