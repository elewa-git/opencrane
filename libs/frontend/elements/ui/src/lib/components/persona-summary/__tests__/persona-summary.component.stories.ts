import type { Meta, StoryObj } from "@storybook/angular";

import { PersonaSummaryComponent } from "../persona-summary.component";
import { PersonaArchetypeScore, PersonaArchetypeTones } from "../persona-summary.types";

/** Stable complete score vector used by persona-summary stories. */
const _SCORES: readonly PersonaArchetypeScore[] =
[
	{ id: "analyst", label: "Analyst", percentage: 38, tone: PersonaArchetypeTones.Analyst },
	{ id: "anchor", label: "Anchor", percentage: 29, tone: PersonaArchetypeTones.Anchor },
	{ id: "commander", label: "Commander", percentage: 18, tone: PersonaArchetypeTones.Commander },
	{ id: "catalyst", label: "Catalyst", percentage: 15, tone: PersonaArchetypeTones.Catalyst }
];

/** Storybook catalogue metadata for reviewed persona summaries. */
const meta: Meta<PersonaSummaryComponent> =
{
	title: "Foundation/Persona summary",
	component: PersonaSummaryComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A reviewable presentation of a persona result and its supplied score vector. It makes the basis for an owner decision legible without turning a visual result into an active persona."
			}
		}
	},
	args:
	{
		componentId: "persona-summary",
		archetype: "The Analyst",
		tone: PersonaArchetypeTones.Analyst,
		description: "Methodical, evidence-led, and comfortable naming uncertainty.",
		secondaryInfluence: "Anchor",
		modifier: "Explorer",
		scores: _SCORES
	}
};

export default meta;

/** Local Storybook story type for persona-summary states. */
type Story = StoryObj<PersonaSummaryComponent>;

/** Typical reviewed persona with a complete four-colour vector. */
export const Typical: Story =
{
	parameters: { docs: { description: { story: "The standard reviewed result with an explicit four-archetype vector. It is the baseline for the primary archetype, secondary influence, modifier, and complete evidence distribution." } } },
	tags: ["visual-test"]
};

/** Narrow layout with long translated result content. */
export const NarrowLongContent: Story =
{
	parameters: { docs: { description: { story: "Longer Dutch result content in the minimum supported reading width. It guards the review surface against clipped evidence or an unreadable score explanation in localized use." } } },
	tags: ["visual-test"],
	render: function render(args)
	{
		return {
			props:
			{
				...args,
				archetype: "De nauwkeurige en bewijsgerichte analist",
				description: "Je werkt het liefst vanuit controleerbare informatie en wilt dat onzekerheid zichtbaar blijft voordat een aanbeveling actief wordt.",
				secondaryInfluence: "De geduldige en ondersteunende ankerstijl",
				modifier: "Ontdekker"
			},
			template: `
				<div style="max-width:24rem">
					<wo-persona-summary
						[componentId]="componentId"
						[archetype]="archetype"
						[tone]="tone"
						[description]="description"
						[secondaryInfluence]="secondaryInfluence"
						[modifier]="modifier"
						[scores]="scores"
					/>
				</div>
			`
		};
	}
};
