import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ConversationGroupCommandStates } from "@opencrane/state/conversation/workspace";

import { ConversationGroupRequestComponent } from "../components/conversation-group-request/conversation-group-request.component";

/** Shows the explicit company assistant selection; stories own no API or admission authority. */
const meta: Meta<ConversationGroupRequestComponent> = { title: "Conversations/Group assistant request", component: ConversationGroupRequestComponent, tags: ["autodocs"], render: function _Render(args) { return { props: { ...args, requestCount: 0 }, template: `<div style="min-block-size: 100vh" [attr.data-request-count]="requestCount"><wo-conversation-group-request [source]="source" [assistants]="assistants" [selectedId]="selectedId" [state]="state" [error]="error" (assistantSelected)="selectedId = $event" (submitted)="requestCount = requestCount + 1" (dismissed)="source = null" /></div>` }; }, args: { source: { entryId: "message", position: "2", text: "Compare the two delivery proposals and explain the trade-offs." }, assistants: [{ agentServiceId: "company", displayName: "Company assistant" }], selectedId: null, state: ConversationGroupCommandStates.Idle }, parameters: { layout: "fullscreen", docs: { description: { component: "An existing group message starts a separate assistant conversation after an explicit service choice. These fixtures verify the review and disabled controls, not permissions or durable creation." } } } };
export default meta;
type Story = StoryObj<ConversationGroupRequestComponent>;

/** Requires an explicit company assistant choice before the request can be submitted. */
export const Choose: Story = { tags: ["visual-test"] };

/** Verifies selection output independently of the static review screenshot. */
export const SelectAssistant: Story = { play: async function _Choose({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	expect(await dialog.findByRole("button", { name: "Ask assistant" })).toBeDisabled();
	await waitFor(function _AudienceVisible() { expect(dialog.getByText("Everyone currently in this group can read the assistant chat and your follow-ups. Sharing a result posts selected text back to the group.")).toBeVisible(); });
	await userEvent.click(dialog.getByRole("radio", { name: "Company assistant" }));
	expect(dialog.getByRole("button", { name: "Ask assistant" })).toBeEnabled();
	await userEvent.click(dialog.getByRole("button", { name: "Ask assistant" }));
	expect(canvasElement.querySelector("[data-request-count]")).toHaveAttribute("data-request-count", "1");
} };

/** Explains an empty permitted-service directory without offering a personal-assistant fallback. */
export const Unavailable: Story = { args: { assistants: [] }, play: async function _Empty({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	await waitFor(function _Visible() { expect(dialog.getByText(/No company assistant is available/u)).toBeVisible(); });
	expect(dialog.queryByRole("radio")).toBeNull();
} };

/** Keeps selection and dismissal locked while an accepted response is outstanding. */
export const Pending: Story = { args: { selectedId: "company", state: ConversationGroupCommandStates.Submitting }, play: async function _Pending({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	expect(await dialog.findByRole("radio", { name: "Company assistant" })).toBeDisabled();
	expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
} };

/** Keeps a failed request's selected service visible and available for retry. */
export const Retry: Story = { args: { selectedId: "company", state: ConversationGroupCommandStates.Failed, error: "The assistant request could not be confirmed. Try again." } };

/** Keeps the choice and long source text inside the supported narrow viewport. */
export const Narrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { source: { entryId: "message", position: "2", text: "Please compare both proposals, including the expected delivery dates, the total costs, and the practical risks for our team before we decide." } } };
