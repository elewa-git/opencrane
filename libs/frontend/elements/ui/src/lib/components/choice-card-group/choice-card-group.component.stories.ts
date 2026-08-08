import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ChoiceCardGroupComponent } from "./choice-card-group.component";
import { ChoiceCardLayouts, ChoiceCardOption } from "./choice-card-group.types";

/** Stable persona-question options shared by the catalogue stories. */
const _PERSONA_OPTIONS: readonly ChoiceCardOption[] =
[
	{ id: "direct", label: "Give me the recommendation", description: "Lead with the call, then show the evidence." },
	{ id: "shape", label: "Sketch the shape first", description: "Build the context before choosing a direction." },
	{ id: "explore", label: "Explore several paths", description: "Keep alternatives visible until the trade-offs are clear." },
	{ id: "challenge", label: "Challenge my premise", description: "Test whether I am solving the right problem." }
];

/** Storybook catalogue metadata for selectable paper cards. */
const meta: Meta<ChoiceCardGroupComponent> =
{
	title: "Foundation/Choice card group",
	component: ChoiceCardGroupComponent,
	tags: ["autodocs"],
	args:
	{
		controlId: "working-style",
		legend: "When a decision is unclear, what should your agent do first?",
		options: _PERSONA_OPTIONS,
		layout: ChoiceCardLayouts.Grid
	}
};

export default meta;

/** Local Storybook story type for the choice-card catalogue. */
type Story = StoryObj<ChoiceCardGroupComponent>;

/** Required question before the user has selected an answer. */
export const Unselected: Story =
{
	tags: ["visual-test"]
};

/** Selected card and its folded-corner treatment. */
export const Selected: Story =
{
	tags: ["visual-test"],
	args:
	{
		selectedId: "direct"
	}
};

/** Invalid submission with an associated accessible error. */
export const ValidationError: Story =
{
	tags: ["visual-test"],
	args:
	{
		validationMessage: "Choose one answer before continuing."
	}
};

/** Whole-group disabled state while a durable answer is being saved. */
export const Disabled: Story =
{
	tags: ["visual-test"],
	args:
	{
		selectedId: "shape",
		disabled: true
	}
};

/** Long and localised content constrained to a narrow container. */
export const NarrowLongContent: Story =
{
	tags: ["visual-test"],
	render: function render(args)
	{
		return {
			props:
			{
				...args,
				controlId: "localized-working-style",
				legend: "Wanneer de informatie onvolledig is, hoe wil je dat je agent onzekerheid zichtbaar maakt?",
				layout: ChoiceCardLayouts.Stack
			},
			template: `
				<div style="max-width:22rem">
					<wo-choice-card-group [controlId]="controlId" [legend]="legend" [options]="options" [layout]="layout" />
				</div>
			`
		};
	}
};

/** User selection emits a stable value and updates the controlled state. */
export const InteractionSelect: Story =
{
	render: function render(args)
	{
		return {
			props: { ...args, selectedId: null },
			template: `
				<wo-choice-card-group
					[controlId]="controlId"
					[legend]="legend"
					[options]="options"
					[selectedId]="selectedId"
					[layout]="layout"
					(selectedIdChange)="selectedId = $event"
				/>
			`
		};
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const choice = canvas.getByRole("radio", { name: /Sketch the shape first/ });
		await userEvent.click(choice);
		await expect(choice).toBeChecked();
	}
};
