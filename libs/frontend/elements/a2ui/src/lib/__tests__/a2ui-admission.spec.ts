import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import type { A2UIClientEvent, Types } from "@a2ui/angular/v0_8";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiOperation } from "@opencrane/contracts";

import { _ToA2uiDisplayedActionIntent } from "../a2ui-action-intent";
import { _AdmitA2uiSurfacePresentation } from "../a2ui-admission";
import { _OpenCraneA2uiCatalog } from "../a2ui.catalog";
import { A2uiComponentNames, type A2uiSurfacePresentation } from "../a2ui.types";

/** Stable text operation used by admission and action-intent tests. */
const _TEXT_OPERATION: AgUiA2uiOperation =
{
	surfaceUpdate:
	{
		surfaceId: "surface-pricing",
		components:
		[
			{ id: "heading", component: { Text: { text: { literalString: "Apply the proposed pricing?" } } } }
		]
	}
};

/** Build one valid presentation while allowing each test to replace focused fields. */
function _presentation(overrides: Partial<A2uiSurfacePresentation> = {}): A2uiSurfacePresentation
{
	return {
		version: AG_UI_A2UI_ENVELOPE_VERSION,
		conversationId: "conversation-1",
		runId: "run-1",
		messageId: "message-1",
		surfaceId: "surface-pricing",
		sequence: 4,
		state: AgUiA2uiSurfaceStates.Ready,
		operations: [_TEXT_OPERATION],
		...overrides
	};
}

/** Build one upstream event without leaking the Subject into the asserted intent. */
function _event(name = "apply-pricing", context: Record<string, unknown> = {}): A2UIClientEvent
{
	return {
		message:
		{
			userAction:
			{
				name,
				surfaceId: "surface-pricing",
				sourceComponentId: "apply-button",
				timestamp: "2026-08-11T00:00:00.000Z",
				context
			}
		},
		completion: new Subject<Types.ServerToClientMessage[]>()
	};
}

describe("A2UI display admission", function _A2uiDisplayAdmission()
{
	it("admits ordered operations for the exact stable surface", function _AdmitsStableSurface()
	{
		expect(_AdmitA2uiSurfacePresentation(_presentation())).toBe(true);
	});

	it("rejects a foreign surface operation", function _RejectsForeignSurface()
	{
		const operation: AgUiA2uiOperation = { beginRendering: { surfaceId: "surface-other", root: "heading" } };
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation] }))).toBe(false);
	});

	it("rejects unknown components without retaining their payload", function _RejectsUnknownComponent()
	{
		const operation =
		{
			surfaceUpdate:
			{
				surfaceId: "surface-pricing",
				components: [{ id: "unknown", component: { RawHtml: { html: "<script>bad()</script>" } } }]
			}
		} as unknown as AgUiA2uiOperation;
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation] }))).toBe(false);
	});

});

describe("A2UI catalogue", function _A2uiCatalogue()
{
	it("contains exactly the eleven v4 visual contracts backed by pinned or owned protocol renderers", function _ContainsExactCatalogue()
	{
		const names = Object.keys(_OpenCraneA2uiCatalog()).sort();
		expect(names).toEqual(Object.values(A2uiComponentNames).sort());
		expect(names).toHaveLength(11);
		expect(names).toContain(A2uiComponentNames.SingleChoice);
		expect(names).toContain(A2uiComponentNames.Select);
	});

	it("keeps multiple choice distinct while enforcing one selection for its two v4 aliases", function _ConstrainsChoiceSemantics()
	{
		const options = [{ label: { literalString: "One" }, value: "one" }, { label: { literalString: "Two" }, value: "two" }];
		const operation = function _ChoiceOperation(name: A2uiComponentNames, maxAllowedSelections: number, selections: readonly string[] = ["one"]): AgUiA2uiOperation
		{
			return { surfaceUpdate: { surfaceId: "surface-pricing", components: [{ id: "choice", component: { [name]: { selections: { literalArray: selections }, options, maxAllowedSelections } } }] } } as unknown as AgUiA2uiOperation;
		};

		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.SingleChoice, 1)] }))).toBe(true);
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.Select, 1)] }))).toBe(true);
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.MultipleChoice, 2)] }))).toBe(true);
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.SingleChoice, 2)] }))).toBe(false);
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.Select, 2)] }))).toBe(false);
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.SingleChoice, 1, ["one", "two"])] }))).toBe(false);
		expect(_AdmitA2uiSurfacePresentation(_presentation({ operations: [operation(A2uiComponentNames.Select, 1, ["one", "two"])] }))).toBe(false);

	});
});

describe("displayed A2UI action intent", function _DisplayedA2uiActionIntent()
{
	it("copies full display coordinates and bounded values only", function _MapsNarrowIntent()
	{
		const upstreamEvent = _event("apply-pricing", { decision: "apply", revisions: [1, 2], confirmed: true });
		const intent = _ToA2uiDisplayedActionIntent(_presentation(), upstreamEvent);
		expect(intent).toEqual({
			version: AG_UI_A2UI_ENVELOPE_VERSION,
			conversationId: "conversation-1",
			runId: "run-1",
			messageId: "message-1",
			surfaceId: "surface-pricing",
			sequence: 4,
			displayedActionId: "apply-pricing",
			sourceComponentId: "apply-button",
			values: { decision: "apply", revisions: [1, 2], confirmed: true }
		});
		expect(intent).not.toHaveProperty("completion");
		expect(intent).not.toHaveProperty("timestamp");
		expect(intent).not.toHaveProperty("context");
	});

	it("rejects local field-change events and non-ready surfaces", function _RejectsNonActions()
	{
		expect(_ToA2uiDisplayedActionIntent(_presentation(), _event("input", { value: "draft" }))).toBeNull();
		expect(_ToA2uiDisplayedActionIntent(_presentation({ state: AgUiA2uiSurfaceStates.ActionPending }), _event())).toBeNull();
	});

	it("rejects nested objects instead of forwarding arbitrary protocol context", function _RejectsNestedContext()
	{
		expect(_ToA2uiDisplayedActionIntent(_presentation(), _event("apply-pricing", { proof: { token: "secret" } }))).toBeNull();
	});
});
