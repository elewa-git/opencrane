import { describe, expect, it } from "vitest";

import { OciImageValidationActions, OciImageValidationEvents, __OciImageValidationTransition } from "../oci-image-validation/oci-image-validation-state";
import { OciImageValidationStates } from "../oci-image-validation/oci-image-validation.types";

describe("OCI image admission state", function _OciImageAdmissionStateSuite()
{
	it("runs admission only while the saved record is pending", function _RunsPendingAdmission()
	{
		expect(__OciImageValidationTransition(OciImageValidationStates.Pending, OciImageValidationEvents.Replay)).toBe(OciImageValidationActions.Admit);
		expect(__OciImageValidationTransition(OciImageValidationStates.Pending, OciImageValidationEvents.ImportAccepted)).toBe(OciImageValidationActions.StoreImported);
		expect(__OciImageValidationTransition(OciImageValidationStates.Pending, OciImageValidationEvents.AdmissionRejected)).toBe(OciImageValidationActions.StoreRejected);
	});

	it("returns stored final states and rejects a second decision", function _ReturnsStoredDecision()
	{
		expect(__OciImageValidationTransition(OciImageValidationStates.Imported, OciImageValidationEvents.Replay)).toBe(OciImageValidationActions.ReturnStored);
		expect(__OciImageValidationTransition(OciImageValidationStates.Rejected, OciImageValidationEvents.Replay)).toBe(OciImageValidationActions.ReturnStored);
		expect(__OciImageValidationTransition(OciImageValidationStates.Imported, OciImageValidationEvents.AdmissionRejected)).toBe(OciImageValidationActions.Invalid);
		expect(__OciImageValidationTransition(OciImageValidationStates.Rejected, OciImageValidationEvents.ImportAccepted)).toBe(OciImageValidationActions.Invalid);
	});
});
