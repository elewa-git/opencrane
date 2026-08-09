import type { Meta, StoryObj } from "@storybook/angular";

import { SectionHeadingComponent } from "./section-heading.component";

/** Storybook catalogue metadata for retained section headings. */
const meta: Meta<SectionHeadingComponent> =
{
	title: "Foundation/Section heading",
	component: SectionHeadingComponent,
	tags: ["autodocs"]
};

export default meta;

/** Local Storybook story type for the heading catalogue. */
type Story = StoryObj<SectionHeadingComponent>;

/** Typical heading with explanatory copy. */
export const Typical: Story =
{
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
	tags: ["visual-test"],
	args:
	{
		title: "Toegangsbeleid voor goedgekeurde verbindingen",
		subtitle: "Bepaal welke teams en individuele gebruikers elke verbinding mogen installeren en gebruiken."
	}
};
