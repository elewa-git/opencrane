import { describe, expect, it } from "vitest";

import { AG_UI_RUN_WAIT_STATE_EVENT, AgUiRunWaitOperations, AgUiRunWaitReasons, AgUiRunWaitSources } from "../ag-ui-projection.types";
import { ___ParseAgUiRunWaitState } from "../ag-ui-projection.validator";

/** Build one valid authority-scoped wait envelope. */
function _Envelope()
{
	return { version: AG_UI_RUN_WAIT_STATE_EVENT, runId: "run-1", source: AgUiRunWaitSources.Runtime, operation: AgUiRunWaitOperations.Add, waits: [{ id: "tool:opaque", reason: AgUiRunWaitReasons.ExternalAction }] };
}

describe("AG-UI run wait validation", function _Suite()
{
	it("accepts the strict authority-owned envelope", function _AcceptsEnvelope()
	{
		expect(___ParseAgUiRunWaitState(_Envelope())).toEqual(_Envelope());
	});

	it("rejects unknown fields, duplicate ids, and cross-authority reasons", function _RejectsUnownedShapes()
	{
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), extra: true })).toBeNull();
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), waits: [_Envelope().waits[0], _Envelope().waits[0]] })).toBeNull();
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), waits: [{ id: "tool:opaque", reason: AgUiRunWaitReasons.Approval }] })).toBeNull();
	});

	it("accepts an empty replacement but rejects empty add and remove operations", function _ChecksEmptyOperations()
	{
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), operation: AgUiRunWaitOperations.Replace, waits: [] })).not.toBeNull();
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), waits: [] })).toBeNull();
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), operation: AgUiRunWaitOperations.Remove, waits: [] })).toBeNull();
	});

	it("rejects identifiers that the browser cannot retain", function _BoundsIdentifiers()
	{
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), waits: [{ id: "x".repeat(256), reason: AgUiRunWaitReasons.ExternalAction }] })).not.toBeNull();
		expect(___ParseAgUiRunWaitState({ ..._Envelope(), waits: [{ id: "x".repeat(257), reason: AgUiRunWaitReasons.ExternalAction }] })).toBeNull();
	});
});
