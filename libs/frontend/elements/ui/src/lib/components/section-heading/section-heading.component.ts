import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { SectionHeadingLevels } from "./section-heading.types";

/**
 * Introduces a page or section and leaves an optional action area to its consumer.
 *
 * The title and subtitle own hierarchy and wrapping. Controls projected into `heading-actions` keep
 * their own click and authority behaviour, so this shared component never decides what a user may do.
 */
@Component({
	selector: "wo-section-heading",
	standalone: true,
	templateUrl: "./section-heading.component.html",
	styleUrl: "./section-heading.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class SectionHeadingComponent
{
	/** Approved heading levels exposed to the template for semantic element selection. */
	public readonly levels = SectionHeadingLevels;

	/** Heading title. */
	public readonly title = input.required<string>();

	/** Optional subtitle. */
	public readonly subtitle = input<string | undefined>(undefined);

	/** Visual and semantic hierarchy for this heading. */
	public readonly level = input<SectionHeadingLevels>(SectionHeadingLevels.Section);
}
