import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { DrawerModule } from "primeng/drawer";

import { SettingsNavigationComponent } from "./settings-navigation.component";

/** Responsive settings frame that keeps route content separate from navigation state. */
@Component({ selector: "wo-settings-shell", standalone: true, imports: [RouterOutlet, ButtonModule, DrawerModule, SettingsNavigationComponent], templateUrl: "./settings-shell.component.html", styleUrl: "./settings-shell.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class SettingsShellComponent
{
	/** Whether the compact settings navigation drawer is visible. */
	protected readonly navigationOpen = signal(false);
}
