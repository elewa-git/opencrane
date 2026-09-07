import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { GroupChildStates } from "@opencrane/models/conversations";

import { ConversationGroupMessageActionsComponent } from "../components/conversation-group-message-actions/conversation-group-message-actions.component";

/** Shows child creation progress without confusing a ready conversation with a finished assistant result. */
const meta: Meta<ConversationGroupMessageActionsComponent> = { title: "Conversations/Group message actions", component: ConversationGroupMessageActionsComponent, tags: ["autodocs"], render: function _Render(args) { return { props: { ...args, openedChild: "", asked: false, shared: false }, template: `<div [attr.data-opened-child]="openedChild" [attr.data-shared]="shared"><wo-conversation-group-message-actions [canAsk]="canAsk" [canShare]="canShare" [children]="children" (childRequested)="openedChild = $event" (askRequested)="asked = true" (shareRequested)="shared = true" /></div>` }; }, args: { canAsk: true, canShare: false }, parameters: { docs: { description: { component: "Message actions reuse the workspace's buttons. The feature supplies request eligibility and currently readable child states; the component cannot create children or authorize navigation." } } } };
export default meta;
type Story = StoryObj<ConversationGroupMessageActionsComponent>;

/** Makes only ready children navigable and announces pending or unavailable creation honestly. */
export const ChildStates: Story = { tags: ["visual-test"], args: { children: [{ conversationId: "pending", parentConversationId: "group", parentMessageId: "message", parentMessagePosition: "2", state: GroupChildStates.Pending, agentName: "Research assistant" }, { conversationId: "ready", parentConversationId: "group", parentMessageId: "message", parentMessagePosition: "2", state: GroupChildStates.Ready, agentName: "Company assistant" }, { conversationId: "unavailable", parentConversationId: "group", parentMessageId: "message", parentMessagePosition: "2", state: GroupChildStates.Unavailable, agentName: "Planning assistant" }] } };

/** Verifies that the ready child emits a navigation intent. */
export const OpenReady: Story = { args: ChildStates.args, play: async function _States({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(canvas.queryByRole("button", { name: /Open Research/u })).toBeNull();
	expect(canvas.queryByRole("button", { name: /Open Planning/u })).toBeNull();
	await userEvent.click(canvas.getByRole("button", { name: "Open Company assistant conversation" }));
	expect(canvasElement.querySelector("[data-opened-child]")).toHaveAttribute("data-opened-child", "ready");
} };

/** Verifies that an eligible assistant result emits a request for the feature-owned share review. */
export const ShareResult: Story = { args: { canAsk: false, canShare: true, children: [] }, play: async function _Share({ canvasElement })
{
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button", { name: "Share result to group" }));
	expect(canvasElement.querySelector("[data-shared]")).toHaveAttribute("data-shared", "true");
} };
