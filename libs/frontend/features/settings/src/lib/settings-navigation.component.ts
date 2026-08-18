import { ChangeDetectionStrategy, Component, output } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";

/** Settings navigation that exposes only destinations backed by real routes. */
@Component({ selector: "wo-settings-navigation", standalone: true, imports: [RouterLink, RouterLinkActive], templateUrl: "./settings-navigation.component.html", styleUrl: "./settings-navigation.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class SettingsNavigationComponent
{
	/** Tells a compact drawer host that navigation completed. */
	public readonly navigated = output<void>();
}
