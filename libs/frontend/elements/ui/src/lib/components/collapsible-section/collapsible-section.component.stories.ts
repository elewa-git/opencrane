import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { CollapsibleSectionComponent } from "./collapsible-section.component";
import { CollapsibleSectionVariants } from "./collapsible-section.types";

/** Storybook catalogue metadata for expandable section states. */
const meta: Meta<CollapsibleSectionComponent> =
{
	title: "Foundation/Collapsible section",
	component: CollapsibleSectionComponent,
	tags: ["autodocs"]
};

export default meta;

/** Local Storybook story type for the collapsible catalogue. */
type Story = StoryObj<CollapsibleSectionComponent>;

/** Expanded light-panel state with realistic projected content. */
export const PanelExpanded: Story =
{
	tags: ["visual-test"],
	args:
	{
		sectionId: "persona-evidence",
		title: "Why this result",
		defaultOpen: true,
		variant: CollapsibleSectionVariants.Panel
	},
	render: function render(args)
	{
		return {
			props: args,
			template: `
				<wo-collapsible-section [sectionId]="sectionId" [title]="title" [defaultOpen]="defaultOpen" [variant]="variant">
					<p style="margin:0;padding:0 var(--oc-space-4);color:var(--oc-ink-muted);line-height:1.6">
						You chose direct feedback, clear priorities, and a practical first recommendation.
					</p>
				</wo-collapsible-section>
			`
		};
	}
};

/** Collapsed light-panel state. */
export const PanelCollapsed: Story =
{
	tags: ["visual-test"],
	args:
	{
		sectionId: "persona-answers",
		title: "Your answers",
		defaultOpen: false,
		variant: CollapsibleSectionVariants.Panel
	}
};

/** Dark-rail state retained for the context surface. */
export const Rail: Story =
{
	tags: ["visual-test"],
	args:
	{
		sectionId: "context-skills",
		title: "Active skills",
		defaultOpen: true,
		variant: CollapsibleSectionVariants.Rail
	},
	render: function render(args)
	{
		return {
			props: args,
			template: `
				<div style="padding:var(--oc-space-4);background:var(--oc-sidebar-background)">
					<wo-collapsible-section [sectionId]="sectionId" [title]="title" [defaultOpen]="defaultOpen" [variant]="variant">
						<p style="margin:0;padding:0 var(--oc-space-3);color:var(--oc-sidebar-foreground)">document-writer · strategy-analyst</p>
					</wo-collapsible-section>
				</div>
			`
		};
	}
};

/** Keyboard interaction contract for the trigger and controlled region. */
export const KeyboardToggle: Story =
{
	args:
	{
		sectionId: "keyboard-contract",
		title: "Keyboard contract",
		defaultOpen: false,
		variant: CollapsibleSectionVariants.Panel
	},
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole("button", { name: "Keyboard contract" });
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(trigger);
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		await expect(canvas.getByRole("region", { name: "Keyboard contract" })).toBeVisible();
	}
};
