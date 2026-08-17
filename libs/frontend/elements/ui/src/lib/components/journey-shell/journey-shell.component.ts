import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { JourneyShellHeaderEmphases, JourneyShellLayouts } from "./journey-shell.types";

/** Paper-backed OpenCrane frame for bounded entry and onboarding journeys. */
@Component({
	selector: "wo-journey-shell",
	standalone: true,
	templateUrl: "./journey-shell.component.html",
	styleUrl: "./journey-shell.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class JourneyShellComponent
{
	/** Layout enum exposed to the template for typed class selection. */
	public readonly layouts = JourneyShellLayouts;

	/** Heading-emphasis enum exposed to the template for typed class selection. */
	public readonly headerEmphases = JourneyShellHeaderEmphases;

	/** Human-readable page title. */
	public readonly title = input.required<string>();

	/** Supporting explanation shown below the title. */
	public readonly description = input<string | undefined>(undefined);

	/** Finite content width for the journey being composed. */
	public readonly layout = input<JourneyShellLayouts>(JourneyShellLayouts.Compact);

	/** Visual priority of the journey context relative to the task inside it. */
	public readonly headerEmphasis = input<JourneyShellHeaderEmphases>(JourneyShellHeaderEmphases.Display);

	/** Whether the owning feature is waiting on a blocking operation. */
	public readonly busy = input<boolean>(false);
}
