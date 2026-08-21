import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { CanvasDocument, CanvasDocumentSaveStates, CanvasRiskSeverities } from "@opencrane/core";
import { ScopeChipAppearances, ScopeChipComponent } from "@opencrane/elements/ui";
import { _CanvasCitationBoundarySummary, _CanvasInitiativeStatusLabel, _CanvasInitiativeStatusTone, _CanvasSaveLabel } from "./canvas-doc.utils";

/** Feature-local visualisation of an authority-supplied canvas document. */
@Component({
	selector: "wo-canvas-doc",
	standalone: true,
	imports: [ScopeChipComponent],
	templateUrl: "./canvas-doc.component.html",
	styleUrl: "./canvas-doc.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CanvasDocComponent
{
	/** Document supplied by the context owner, or null before a document is selected. */
	public readonly document = input<CanvasDocument | null>(null);

	/** Save lifecycle supplied by the context owner. */
	public readonly saveState = input<CanvasDocumentSaveStates>(CanvasDocumentSaveStates.Idle);

	/** Emits a save intent for the context owner to handle. */
	public readonly saveRequested = output<void>();

	/** Emits an export intent for the context owner to handle. */
	public readonly exportRequested = output<void>();

	/** Save-state enum exposed to the template. */
	public readonly saveStates = CanvasDocumentSaveStates;

	/** Risk-severity enum exposed to the template. */
	public readonly riskSeverities = CanvasRiskSeverities;

	/** Shared chip appearance exposed to the template. */
	public readonly chipAppearances = ScopeChipAppearances;

	/** Maps an admitted initiative state to the shared semantic chip treatment. */
	public readonly initiativeStatusTone = _CanvasInitiativeStatusTone;

	/** Maps an admitted initiative state to its readable chip label. */
	public readonly initiativeStatusLabel = _CanvasInitiativeStatusLabel;

	/** Maps the owner-supplied save lifecycle to the visible action label. */
	public readonly saveLabel = _CanvasSaveLabel;

	/** Renders the supplied citation boundary kinds without constructing source data. */
	public readonly citationBoundarySummary = _CanvasCitationBoundarySummary;
}
