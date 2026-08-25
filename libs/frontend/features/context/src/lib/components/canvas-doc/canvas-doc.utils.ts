import { CanvasDocumentSaveStates, CanvasInitiativeStates, ResourceBoundaryKind } from "@opencrane/core";
import { ScopeChipTones } from "@opencrane/elements/ui";

/** Returns the approved shared-chip tone for an initiative state. */
export function _CanvasInitiativeStatusTone(status: CanvasInitiativeStates): ScopeChipTones
{
	switch (status)
	{
		case CanvasInitiativeStates.OnTrack: return ScopeChipTones.Success;
		case CanvasInitiativeStates.AtRisk: return ScopeChipTones.Warning;
		case CanvasInitiativeStates.Pending: return ScopeChipTones.Neutral;
	}
}

/** Returns the readable label for an initiative state. */
export function _CanvasInitiativeStatusLabel(status: CanvasInitiativeStates): string
{
	switch (status)
	{
		case CanvasInitiativeStates.OnTrack: return "On track";
		case CanvasInitiativeStates.AtRisk: return "At risk";
		case CanvasInitiativeStates.Pending: return "Pending";
	}
}

/** Returns the save control label for the owner-supplied lifecycle. */
export function _CanvasSaveLabel(saveState: CanvasDocumentSaveStates): string
{
	switch (saveState)
	{
		case CanvasDocumentSaveStates.Idle: return "Save";
		case CanvasDocumentSaveStates.Saving: return "Saving";
		case CanvasDocumentSaveStates.Saved: return "Saved";
		case CanvasDocumentSaveStates.Failed: return "Retry save";
	}
}

/** Summarises admitted citation boundary kinds without constructing document content locally. */
export function _CanvasCitationBoundarySummary(boundaryKinds: readonly ResourceBoundaryKind[]): string
{
	return boundaryKinds.join(" · ");
}
