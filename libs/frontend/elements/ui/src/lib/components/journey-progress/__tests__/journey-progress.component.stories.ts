import type { Meta, StoryObj } from "@storybook/angular";

import { JourneyProgressComponent } from "../journey-progress.component";

/** Storybook catalogue metadata for finite journey progress. */
const meta: Meta<JourneyProgressComponent> =
{
	title: "Foundation/Journey progress",
	component: JourneyProgressComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A read-only presentation of progress already admitted by an owning journey. It never calculates, advances, or authorizes a workflow position."
			}
		}
	},
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
	parameters: { docs: { description: { story: "A mid-interview position whose completed count and status label have been supplied by the journey owner. It is the standard state for an resumable durable workflow." } } },
	tags: ["visual-test"]
};

/** First position before the journey has accumulated much evidence. */
export const Starting: Story =
{
	parameters: { docs: { description: { story: "The first question before any answer has been admitted. It documents the zero-progress treatment without implying that an empty local form is itself durable state." } } },
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
	parameters: { docs: { description: { story: "The finite completed position after every required answer is saved. The display reports completion; the route still owns any next action such as review or approval." } } },
	tags: ["visual-test"],
	args:
	{
		statusLabel: "Interview complete · 10 answers saved",
		completed: 10
	}
};
