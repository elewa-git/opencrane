import type { Meta, StoryObj } from "@storybook/angular";

import { OpenCraneBrandAppearances, OpenCraneBrandComponent } from "../opencrane-brand.component";

/** Storybook catalogue metadata for the shared OpenCrane brand. */
const meta: Meta<OpenCraneBrandComponent> =
{
	title: "Foundation/OpenCrane brand",
	component: OpenCraneBrandComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The shared product mark and wordmark used to identify OpenCrane in journey and navigation frames. It presents the brand treatment without owning navigation, page hierarchy, or product state."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the OpenCrane brand. */
type Story = StoryObj<OpenCraneBrandComponent>;

/** Compact brand treatment used by bounded onboarding cards. */
export const Default: Story =
{
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "The standard brand treatment shown in product chrome. This state verifies the reusable mark, wordmark typography, and accessible product name without implying a link or action." } } }
};

/** Full wordmark treatment used by persistent application navigation. */
export const Navigation: Story =
{
	args: { appearance: OpenCraneBrandAppearances.Navigation },
	tags: ["visual-test"]
};
