import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MessageModule } from "primeng/message";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";

/** Explains how to admit this browser tab to the current private Tier 2 launch. */
@Component({
	selector: "wo-tier2-development-session-required-page",
	standalone: true,
	imports: [JourneyShellComponent, MessageModule],
	templateUrl: "./tier2-development-session-required-page.component.html",
	styleUrl: "./tier2-development-session-required-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class Tier2DevelopmentSessionRequiredPageComponent
{
	/** Compact entry layout used for the bounded launcher handoff. */
	public readonly layout = JourneyShellLayouts.Compact;
}
