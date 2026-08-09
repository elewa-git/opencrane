import type { Meta, StoryObj } from "@storybook/angular";

import { SectionHeadingComponent } from "../section-heading.component";

/** Storybook catalogue metadata for retained section headings. */
const meta: Meta<SectionHeadingComponent> =
{
	title: "Foundation/Section heading",
	component: SectionHeadingComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A structural heading with optional explanatory copy. It supplies hierarchy and context while leaving the surrounding route responsible for actions and data."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the heading catalogue. */
type Story = StoryObj<SectionHeadingComponent>;

/** Typical heading with explanatory copy. */
export const Typical: Story =
{
	parameters: { docs: { description: { story: "The ordinary two-line section introduction used before a constrained configuration decision. It is the baseline for typography, spacing, and readable supporting copy." } } },
	tags: ["visual-test"],
	args:
	{
		title: "Access policy",
		subtitle: "Choose who can install each approved server."
	}
};

/** Long and localised text verifies wrapping without clipping. */
export const LongLocalized: Story =
{
	parameters: { docs: { description: { story: "Longer Dutch content that exercises the supported wrapping behaviour. It protects translated UI from clipping, overlap, or a visually detached subtitle." } } },
	tags: ["visual-test"],
	args:
	{
		title: "Toegangsbeleid voor goedgekeurde verbindingen",
		subtitle: "Bepaal welke teams en individuele gebruikers elke verbinding mogen installeren en gebruiken."
	}
};
