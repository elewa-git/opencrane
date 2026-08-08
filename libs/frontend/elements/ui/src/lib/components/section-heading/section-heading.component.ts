import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/** Page heading with optional muted subtitle (settings sections). */
@Component({
	selector: "wo-section-heading",
	standalone: true,
	templateUrl: "./section-heading.component.html",
	styleUrl: "./section-heading.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class SectionHeadingComponent
{
	/** Heading title. */
	public readonly title = input.required<string>();

	/** Optional subtitle. */
	public readonly subtitle = input<string | undefined>(undefined);
}
