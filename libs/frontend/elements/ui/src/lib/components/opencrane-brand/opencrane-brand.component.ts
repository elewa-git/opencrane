import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/**
 * Selects the OpenCrane identity treatment that fits the component's frame.
 *
 * Journey cards keep the compact treatment used by their existing visual contract. Persistent
 * navigation uses the larger crane wordmark so the session rail matches the workspace design.
 */
export enum OpenCraneBrandAppearances
{
	/** Shows the small uppercase mark inside journey cards. */
	Compact = "compact",
	/** Shows the full crane wordmark inside persistent application navigation. */
	Navigation = "navigation"
}

/**
 * Renders the non-interactive OpenCrane mark and wordmark with shared visual tokens.
 *
 * The component identifies the product without owning navigation, page hierarchy, or application
 * state. Its static contract keeps product frames from copying the mark and typography styles.
 *
 * Called by: `JourneyShellComponent` and `ConversationListComponent` at the start of their product
 * frames.
 * @see JourneyShellComponent for one frame that owns the brand's surrounding spacing.
 */
@Component({
	selector: "wo-opencrane-brand",
	standalone: true,
	templateUrl: "./opencrane-brand.component.html",
	styleUrl: "./opencrane-brand.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class OpenCraneBrandComponent
{
	/** Frame-specific treatment selected by the component owner. */
	public readonly appearance = input<OpenCraneBrandAppearances>(OpenCraneBrandAppearances.Compact);
	/** Stable appearance vocabulary used by the finite template branch. */
	protected readonly appearances = OpenCraneBrandAppearances;
}
