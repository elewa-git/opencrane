import type { Meta, StoryObj } from "@storybook/angular";
import { ConversationWorkspaceTranscriptComponent } from "../conversation-workspace-transcript.component";

/** Transcript's empty state; routed workspace stories retain long-content and group action coverage. */
const meta: Meta<ConversationWorkspaceTranscriptComponent> = { title: "Conversations/Workspace transcript", component: ConversationWorkspaceTranscriptComponent, tags: ["autodocs"] };
export default meta;
type Story = StoryObj<ConversationWorkspaceTranscriptComponent>;
/** A selected conversation without messages invites the first contribution. */
export const Empty: Story = { tags: ["visual-test"], args: { entries: [] } };
