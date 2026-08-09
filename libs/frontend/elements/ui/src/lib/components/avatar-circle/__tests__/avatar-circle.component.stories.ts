import type { Meta, StoryObj } from "@storybook/angular";

import { AvatarCircleComponent } from "../avatar-circle.component";
import { AvatarSizes, AvatarTones } from "../avatar-circle.types";

/** Storybook catalogue metadata for finite avatar states. */
const meta: Meta<AvatarCircleComponent> =
{
	title: "Foundation/Avatar circle",
	component: AvatarCircleComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A labelled visual identity marker whose tone and size communicate context without carrying permissions or lifecycle state. The catalogue keeps every supported semantic treatment reviewable in one place."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the avatar catalogue. */
type Story = StoryObj<AvatarCircleComponent>;

/** Every supported semantic tone paired with representative sizes. */
export const SemanticTonesAndSizes: Story =
{
	parameters: { docs: { description: { story: "The complete approved tone-and-size matrix, using representative initials and labels. It makes visual regressions across compact participant lists and prominent identity moments immediately comparable." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { tones: AvatarTones, sizes: AvatarSizes },
			template: `
				<div style="display:flex;align-items:end;gap:var(--oc-space-4);padding:var(--oc-space-6);background:var(--oc-surface-paper)">
					<wo-avatar-circle initials="JR" label="Jente Rosseel" [tone]="tones.Brand" [size]="sizes.Large" />
					<wo-avatar-circle initials="AK" label="Alex Kim" [tone]="tones.Blue" [size]="sizes.Medium" />
					<wo-avatar-circle initials="MV" label="Marieke Vos" [tone]="tones.Green" [size]="sizes.Small" />
					<wo-avatar-circle initials="TO" label="Tunde Okafor" [tone]="tones.Amber" [size]="sizes.Small" />
					<wo-avatar-circle initials="+2" label="Two more participants" [tone]="tones.Neutral" [size]="sizes.Compact" />
				</div>
			`
		};
	}
};
