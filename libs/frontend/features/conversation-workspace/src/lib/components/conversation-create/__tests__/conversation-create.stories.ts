import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationModes, ConversationPersonalAgentStatuses } from "@opencrane/state/conversation/workspace";

import { ConversationCreateComponent } from "../conversation-create.component";

/** Exercises the participant-picker composition without owning conversation creation rules. */
const meta: Meta<ConversationCreateComponent> = {
	title: "Conversations/Create conversation",
	component: ConversationCreateComponent,
	tags: ["autodocs"],
	args: {
		visible: true,
		mode: ConversationModes.Group,
		directory: { personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null, companyAssistants: [], participants: [{ participantRef: "self", isSelf: true, label: "You" }, { participantRef: "mary", isSelf: false, label: "Mary Wanjiku" }, { participantRef: "peter", isSelf: false, label: "Peter Otieno" }] },
		selectedParticipantRefs: new Set(["mary"]),
		canCreate: true,
		busy: false,
	},
	render: function _render(args)
	{
		return { props: { ...args, selectedReference: "" }, template: `<div style="min-block-size: 100vh" [attr.data-selected-reference]="selectedReference"><wo-conversation-create [visible]="visible" [mode]="mode" [directory]="directory" [selectedParticipantRefs]="selectedParticipantRefs" [canCreate]="canCreate" [busy]="busy" (participantToggled)="selectedReference = $event" /></div>` };
	},
	parameters: { docs: { description: { component: "Ordinary conversation creation keeps self implicit and delegates peer toggles to the caller. These fixtures prove the reused picker preserves inputs and outputs; the workspace store and API still decide valid creation." } } },
};
export default meta;
type Story = StoryObj<ConversationCreateComponent>;

/** Shows other members and forwards a selected reference without changing who self represents. */
export const Group: Story = { play: async function _group({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	expect(await dialog.findByRole("checkbox", { name: "Mary Wanjiku" })).toBeChecked();
	expect(dialog.queryByRole("checkbox", { name: /You/u })).toBeNull();
	await userEvent.click(dialog.getByRole("checkbox", { name: "Peter Otieno" }));
	expect(canvasElement.querySelector("[data-selected-reference]")).toHaveAttribute("data-selected-reference", "peter");
} };

/** Keeps the Direct selection supplied by the store without imposing a second selection rule. */
export const Direct: Story = { args: { mode: ConversationModes.Direct }, play: async function _direct({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	expect(await dialog.findByRole("checkbox", { name: "Mary Wanjiku" })).toBeChecked();
	expect(dialog.getByRole("checkbox", { name: "Peter Otieno" })).not.toBeChecked();
} };

/** Locks the extracted participant rows with the existing creation command. */
export const Pending: Story = { args: { busy: true, canCreate: false }, play: async function _pending({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	await dialog.findByRole("checkbox", { name: "Mary Wanjiku" });
	for (const checkbox of dialog.getAllByRole("checkbox"))
		expect(checkbox).toBeDisabled();
} };
