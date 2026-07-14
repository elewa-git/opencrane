import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { RouterLink } from "@angular/router";

/** Routed back link and title shared by every Settings sub-page. */
@Component({
	selector: "oc-settings-subpage-header",
	imports: [RouterLink],
	templateUrl: "./settings-subpage-header.component.html",
	styleUrl: "./settings-subpage-header.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsSubpageHeaderComponent
{
	/** Sub-page title. */
	public readonly title = input.required<string>();

	/** Label rendered after the back arrow. */
	public readonly backLabel = input.required<string>();

	/** Route returned to by the back link. */
	public readonly backLink = input.required<string | readonly string[]>();
}
