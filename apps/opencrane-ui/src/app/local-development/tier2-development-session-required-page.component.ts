import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";

import { Tier2DevelopmentSessionGuidanceStates } from "./tier2-development-session.types";

/** Explains how to admit this browser tab to the current private Tier 2 launch. */
@Component({
	selector: "wo-tier2-development-session-required-page",
	standalone: true,
	imports: [ButtonModule, JourneyShellComponent, MessageModule],
	templateUrl: "./tier2-development-session-required-page.component.html",
	styleUrl: "./tier2-development-session-required-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class Tier2DevelopmentSessionRequiredPageComponent
{
	/** Selects the finite recovery copy and navigation behavior supplied by the Tier 2 route. */
	public readonly guidanceState = input<Tier2DevelopmentSessionGuidanceStates>(Tier2DevelopmentSessionGuidanceStates.Missing);

	/** Compact entry layout used for the bounded launcher handoff. */
	public readonly layout = JourneyShellLayouts.Compact;

	/** Guidance members exposed to the exhaustive template switch. */
	public readonly guidanceStates = Tier2DevelopmentSessionGuidanceStates;
}
