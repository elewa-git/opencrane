import type { Meta, StoryObj } from "@storybook/angular";

import { ScopeChipComponent } from "../scope-chip.component";
import { ScopeChipAppearances, ScopeChipTones } from "../scope-chip.types";

/** Storybook catalogue metadata for finite chip states. */
const meta: Meta<ScopeChipComponent> =
{
	title: "Foundation/Scope chip",
	component: ScopeChipComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "A compact scope and status marker that makes the owner-provided meaning visible without granting access. Stories cover the semantic vocabulary and its permitted visual treatments."
			}
		}
	}
};

export default meta;

/** Local Storybook story type for the chip catalogue. */
type Story = StoryObj<ScopeChipComponent>;

/** Every supported semantic tone in the default outlined treatment. */
export const SemanticTones: Story =
{
	parameters: { docs: { description: { story: "The full semantic vocabulary in the default outlined treatment. Review it when adding a scope or status to ensure the colour remains an aid, not the only source of meaning." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { tones: ScopeChipTones },
			template: `
				<div style="display:flex;flex-wrap:wrap;gap:var(--oc-space-3);padding:var(--oc-space-6);background:var(--oc-surface-paper)">
					<wo-scope-chip label="neutral" [tone]="tones.Neutral" />
					<wo-scope-chip label="information" [tone]="tones.Info" />
					<wo-scope-chip label="published" [tone]="tones.Success" />
					<wo-scope-chip label="pending review" [tone]="tones.Warning" />
					<wo-scope-chip label="failed" [tone]="tones.Danger" />
					<wo-scope-chip label="organisation" [tone]="tones.Organization" />
					<wo-scope-chip label="department" [tone]="tones.Department" />
					<wo-scope-chip label="project" [tone]="tones.Project" />
					<wo-scope-chip label="personal" [tone]="tones.Personal" />
				</div>
			`
		};
	}
};

/** Outlined and soft treatments using one semantic meaning. */
export const Appearances: Story =
{
	parameters: { docs: { description: { story: "Two approved treatments for the same personal scope. This documents that appearance changes emphasis only; it never changes the underlying scope or authority." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { tones: ScopeChipTones, appearances: ScopeChipAppearances },
			template: `
				<div style="display:flex;gap:var(--oc-space-3);padding:var(--oc-space-6);background:var(--oc-surface-paper)">
					<wo-scope-chip label="personal" [tone]="tones.Personal" [appearance]="appearances.Outlined" />
					<wo-scope-chip label="personal" [tone]="tones.Personal" [appearance]="appearances.Soft" />
				</div>
			`
		};
	}
};
