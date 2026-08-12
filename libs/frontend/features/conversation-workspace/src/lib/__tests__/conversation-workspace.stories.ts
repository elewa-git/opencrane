import { type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";

import { ConversationOnboardingHistoryStatuses } from "@opencrane/state/conversation/workspace";

import type { ConversationOnboardingHistoryPresentation, ConversationSummaryPresentation } from "../conversation-workspace-feature.types.js";
import { ConversationListComponent } from "../conversation-list/conversation-list.component.js";

/** Privacy-safe rows used by desktop and compact visual contracts. */
const _ITEMS: readonly ConversationSummaryPresentation[] =
[
	{ id: "agent-session", title: "Nova", modeLabel: "Agent session", participantLabel: "You and your Agent", updatedLabel: "11:08", archived: false },
	{ id: "direct", title: "Direct conversation", modeLabel: "Direct", participantLabel: "You and Participant 1", updatedLabel: "10:42", archived: false },
	{ id: "group", title: "Group conversation", modeLabel: "Group", participantLabel: "4 participants", updatedLabel: "Yesterday", archived: false },
	{ id: "archived", title: "Project handoff", modeLabel: "Group", participantLabel: "Archived", updatedLabel: "Monday", archived: true }
];

/** Completed onboarding row shown separately from immutable conversation modes. */
const _ONBOARDING: ConversationOnboardingHistoryPresentation = { id: "onboarding-1", title: "Welcome conversation", personaName: "Nova", completedLabel: "09:15" };

/** Visual-test catalogue for the workspace conversation rail. */
const meta: Meta<ConversationListComponent> =
{
	title: "Conversations/Workspace",
	component: ConversationListComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [ConversationListComponent] })],
	parameters: { docs: { description: { component: "Privacy-safe direct, group, and Agent-session navigation used by the post-onboarding chat workspace." } } }
};

export default meta;
type Story = StoryObj<ConversationListComponent>;

/** Desktop rail shows every immutable conversation mode without opaque participant coordinates. */
export const DesktopModes: Story = { tags: ["visual-test"], args: { items: _ITEMS, onboardingHistory: _ONBOARDING, onboardingHistoryStatus: ConversationOnboardingHistoryStatuses.Ready, selectedId: "agent-session" }, parameters: { viewport: { defaultViewport: "responsive" } } };

/** Compact rail keeps the same readable selection contract. */
export const CompactModes: Story = { tags: ["visual-test"], args: { items: _ITEMS, onboardingHistory: _ONBOARDING, onboardingHistoryStatus: ConversationOnboardingHistoryStatuses.Ready, onboardingSelected: true, selectedId: null }, parameters: { viewport: { defaultViewport: "mobile1" } } };

/** Empty state gives the participant a clear next action. */
export const Empty: Story = { tags: ["visual-test"], args: { items: [], onboardingHistoryStatus: ConversationOnboardingHistoryStatuses.NotRecorded, selectedId: null } };
