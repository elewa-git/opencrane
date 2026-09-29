import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";

import { OpenCraneBrandAppearances, OpenCraneBrandComponent } from "@opencrane/elements/ui";

/** Frames every routine route with stable workspace and routine-list navigation. */
@Component({ selector: "wo-routine-shell", standalone: true, imports: [OpenCraneBrandComponent, RouterLink, RouterLinkActive, RouterOutlet], templateUrl: "./routine-shell.component.html", styleUrl: "./routine-shell.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineShellComponent
{
	/** Uses the shared compact navigation treatment for the product mark. */
	protected readonly brandAppearance = OpenCraneBrandAppearances.Navigation;
}
