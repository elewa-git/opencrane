import type { Meta, StoryObj } from "@storybook/angular";

import { JourneyProgressComponent } from "./journey-progress.component";

/** Storybook catalogue metadata for finite journey progress. */
const meta: Meta<JourneyProgressComponent> =
{
	title: "Foundation/Journey progress",
	component: JourneyProgressComponent,
	tags: ["autodocs"],
	args:
	{
		label: "Persona sorting progress",
		statusLabel: "Question 6 of 10 · 5 answers saved",
		completed: 5,
		total: 10
	}
};

export default meta;

/** Local Storybook story type for journey-progress states. */
type Story = StoryObj<JourneyProgressComponent>;

/** Active interview with durable progress already recorded. */
export const InProgress: Story =
{
	tags: ["visual-test"]
};

/** First position before the journey has accumulated much evidence. */
export const Starting: Story =
{
	tags: ["visual-test"],
	args:
	{
		statusLabel: "Question 1 of 10 · no answers saved",
		completed: 0
	}
};

/** Finite journey after every position has been completed. */
export const Complete: Story =
{
	tags: ["visual-test"],
	args:
	{
		statusLabel: "Interview complete · 10 answers saved",
		completed: 10
	}
};
