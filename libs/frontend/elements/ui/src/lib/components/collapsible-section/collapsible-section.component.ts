import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from "@angular/core";

import { CollapsibleSectionVariants } from "./collapsible-section.types";

/** Collapsible section with an uppercase header and rotating chevron. */
@Component({
	selector: "wo-collapsible-section",
	standalone: true,
	templateUrl: "./collapsible-section.component.html",
	styleUrl: "./collapsible-section.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollapsibleSectionComponent
{
	/** Variant enum exposed to the template for typed class selection. */
	public readonly variants = CollapsibleSectionVariants;

	/** Stable DOM id joining the trigger to its controlled panel. */
	public readonly sectionId = input.required<string>();

	/** Uppercase section title. */
	public readonly title = input.required<string>();

	/** Whether the section starts open. */
	public readonly defaultOpen = input<boolean>(true);

	/** Semantic surface variant. */
	public readonly variant = input<CollapsibleSectionVariants>(CollapsibleSectionVariants.Panel);

	/** Open state, seeded from defaultOpen and toggled locally thereafter. */
	public readonly open = linkedSignal<boolean>(() => this.defaultOpen());

	/** Emits the resulting expanded state after a user toggle. */
	public readonly expandedChange = output<boolean>();

	/** Toggles the section open/closed. */
	public toggle(): void
	{
		this.open.update(function flip(current: boolean): boolean { return !current; });
		this.expandedChange.emit(this.open());
	}
}
