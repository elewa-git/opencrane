import { type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";

import { ConversationSessionRailItemKinds, type ConversationRailIdentityPresentation, type ConversationSessionRailItemPresentation } from "../conversation-workspace-feature.types";
import { ConversationListComponent } from "../components/conversation-list/conversation-list.component";

/** Privacy-safe rows used by desktop and compact visual contracts. */
const _ITEMS: readonly ConversationSessionRailItemPresentation[] =
[
	{ key: "onboarding:onboarding-1", kind: ConversationSessionRailItemKinds.Onboarding, conversationId: null, title: "Welcome", detail: "Private chat · Read-only", updatedLabel: "09:15", archived: false },
	{ key: "agent-session", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "agent-session", title: "Nova", detail: "Agent session · You and your Agent", updatedLabel: "11:08", archived: false },
	{ key: "direct", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "direct", title: "Direct conversation", detail: "Direct · You and Participant 1", updatedLabel: "10:42", archived: false },
	{ key: "group", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "group", title: "Group conversation", detail: "Group · 4 participants", updatedLabel: "Yesterday", archived: false },
	{ key: "archived", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "archived", title: "Project handoff", detail: "Group · 3 participants", updatedLabel: "Monday", archived: true }
];

/** Generic directory-derived self label used by the rail catalogue. */
const _IDENTITY: ConversationRailIdentityPresentation = { name: "You", detail: "Private workspace", initials: "Y" };

/** Visual-test catalogue for the workspace session rail. */
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
export const CompactModes: Story = { tags: ["visual-test", "visual-test-narrow"], args: { items: _ITEMS, selectedKey: "onboarding:onboarding-1", identity: _IDENTITY }, parameters: { viewport: { defaultViewport: "mobile1" } } };

/** Empty state gives the participant a clear next action without mentioning missing onboarding history. */
export const Empty: Story = { tags: ["visual-test"], args: { items: [], selectedKey: null, identity: _IDENTITY } };
