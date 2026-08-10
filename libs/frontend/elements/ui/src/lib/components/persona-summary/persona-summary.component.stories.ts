import type { Meta, StoryObj } from "@storybook/angular";

import { PersonaSummaryComponent } from "./persona-summary.component";
import { PersonaArchetypeScore, PersonaArchetypeTones } from "./persona-summary.types";

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
	tags: ["visual-test"]
};

/** Narrow layout with long translated result content. */
export const NarrowLongContent: Story =
{
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
