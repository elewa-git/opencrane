import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

/** Coordinator-owned buildable router outlet transferred to the feature shell in A1. */
@Component({
	selector: "oc-route-placeholder",
	imports: [RouterOutlet],
	templateUrl: "./route-placeholder.component.html",
	styleUrl: "./route-placeholder.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoutePlaceholderComponent
{
}
