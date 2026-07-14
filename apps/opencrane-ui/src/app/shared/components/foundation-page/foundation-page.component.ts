import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/** Accessible G1 placeholder proving route, mock access, theme, and E2E seams are buildable. */
@Component({
	selector: "oc-foundation-page",
	templateUrl: "./foundation-page.component.html",
	styleUrl: "./foundation-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class FoundationPageComponent
{
	/** Route-specific heading displayed until the owning feature lane replaces this page. */
	public readonly heading = input<string>("OpenCrane UI foundation");
}
