import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { UiCitation } from "../../../core/models/session.types.js";

/** Compact accessible metadata strip for one assistant citation. */
@Component({
	selector: "oc-citation-strip",
	templateUrl: "./citation-strip.component.html",
	styleUrl: "./citation-strip.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CitationStripComponent
{
	/** Citation rendered by the strip. */
	public readonly citation = input.required<UiCitation>();
}
