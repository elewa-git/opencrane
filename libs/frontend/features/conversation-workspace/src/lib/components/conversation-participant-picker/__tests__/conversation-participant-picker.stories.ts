import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationParticipantPickerComponent } from "../conversation-participant-picker.component";

/** Gives the stories controlled selection without creating or changing a conversation. */
function _toggleParticipant(selected: readonly string[], participantRef: string): readonly string[]
{
	return selected.includes(participantRef) ? selected.filter(reference => reference !== participantRef) : [...selected, participantRef];
}

/** Shows the shared participant control with server-labelled rows and no membership authority. */
const meta: Meta<ConversationParticipantPickerComponent> = {
	title: "Conversations/Participant picker",
	component: ConversationParticipantPickerComponent,
	tags: ["autodocs"],
	args: {
		controlId: "participant-picker-story",
		legend: "Who can read this assistant chat?",
		participants: [{ participantRef: "self", isSelf: true, label: "You" }, { participantRef: "mary", isSelf: false, label: "Mary Wanjiku" }, { participantRef: "peter", isSelf: false, label: "Peter Otieno" }],
		selectedParticipantRefs: [],
		disabled: false,
	},
	render: function _render(args)
	{
		return { props: { ...args, toggleParticipant: _toggleParticipant }, template: `<div style="padding: var(--oc-space-4)"><wo-conversation-participant-picker [controlId]="controlId" [legend]="legend" [participants]="participants" [selectedParticipantRefs]="selectedParticipantRefs" [disabled]="disabled" (participantToggled)="selectedParticipantRefs = toggleParticipant(selectedParticipantRefs, $event)" /></div>` };
	},
	parameters: { docs: { description: { component: "A labelled participant checkbox group with a fixed requester. The caller controls additional selections; these fixtures do not grant access or submit invitations." } } },
};
export default meta;
type Story = StoryObj<ConversationParticipantPickerComponent>;

/** Keeps the requester included without selecting anybody else. */
export const RequesterOnly: Story = { tags: ["visual-test"], play: async function _requesterOnly({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(canvas.getByRole("checkbox", { name: /You/u })).toBeChecked();
	expect(canvas.getByRole("checkbox", { name: /You/u })).toBeDisabled();
	expect(canvas.getByRole("checkbox", { name: "Mary Wanjiku" })).not.toBeChecked();
} };

/** Allows independent additional recipients to be checked and unchecked by keyboard. */
export const KeyboardSelection: Story = { play: async function _keyboard({ canvasElement })
{
	const canvas = within(canvasElement);
	const mary = canvas.getByRole("checkbox", { name: "Mary Wanjiku" });
	mary.focus();
	await userEvent.keyboard("[Space]");
	expect(mary).toBeChecked();
	await userEvent.tab();
	expect(canvas.getByRole("checkbox", { name: "Peter Otieno" })).toHaveFocus();
	await userEvent.keyboard("[Space]");
	expect(canvas.getByRole("checkbox", { name: "Peter Otieno" })).toBeChecked();
	await userEvent.click(mary);
	expect(mary).not.toBeChecked();
	expect(canvas.getByRole("checkbox", { name: /You/u })).toBeChecked();
} };

/** Displays the additional people the caller already selected. */
export const Selected: Story = { args: { selectedParticipantRefs: ["mary", "peter"] }, tags: ["visual-test"] };

/** Makes every input unavailable without hiding the captured audience. */
export const Pending: Story = { args: { selectedParticipantRefs: ["mary"], disabled: true }, play: async function _pending({ canvasElement })
{
	for (const checkbox of within(canvasElement).getAllByRole("checkbox"))
		expect(checkbox).toBeDisabled();
} };

/** Shows the ordinary conversation control when no other member is available. */
export const Empty: Story = { args: { participants: [], legend: "Participants" } };

/** Retains readable names and fixed-requester copy at the supported narrow width. */
export const LongNamesNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { selectedParticipantRefs: ["mary"], participants: [{ participantRef: "self", isSelf: true, label: "You" }, { participantRef: "mary", isSelf: false, label: "Mary Wanjiku — Nakuru agricultural supplies and inventory coordination" }] } };
