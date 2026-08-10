import { describe, expect, it } from "vitest";

import { CanvasDocumentSaveStates, CanvasInitiativeStates } from "@opencrane/core";
import { ScopeChipTones } from "@opencrane/elements/ui";

import { _CanvasInitiativeStatusTone, _CanvasSaveLabel } from "../canvas-doc.utils";

describe("CanvasDocComponent presentation contract", function _CanvasDocContractSuite(): void
{
	it("maps only admitted initiative states onto shared semantic chip tones", function _InitiativeToneMapping(): void
	{
		expect(_CanvasInitiativeStatusTone(CanvasInitiativeStates.OnTrack)).toBe(ScopeChipTones.Success);
		expect(_CanvasInitiativeStatusTone(CanvasInitiativeStates.AtRisk)).toBe(ScopeChipTones.Warning);
		expect(_CanvasInitiativeStatusTone(CanvasInitiativeStates.Pending)).toBe(ScopeChipTones.Neutral);
	});

	it("renders save labels from the owner-supplied lifecycle without a timer transition", function _SaveLifecycleLabels(): void
	{
		expect(_CanvasSaveLabel(CanvasDocumentSaveStates.Idle)).toBe("Save");
		expect(_CanvasSaveLabel(CanvasDocumentSaveStates.Saving)).toBe("Saving");
		expect(_CanvasSaveLabel(CanvasDocumentSaveStates.Saved)).toBe("Saved");
		expect(_CanvasSaveLabel(CanvasDocumentSaveStates.Failed)).toBe("Retry save");
	});
});
