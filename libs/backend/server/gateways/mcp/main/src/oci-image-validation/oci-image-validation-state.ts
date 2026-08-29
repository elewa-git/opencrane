import { OciImageValidationStates } from "./oci-image-validation.types";
import type { OciImageAdmissionResult } from "./oci-image-validation.types";
import type { OciImageValidationRecord } from "./oci-image-validation-repository.types";

/**
 * Describes what the admission workflow observed before it chooses a state-table action.
 *
 * These values exist in memory only. The workflow and state tests branch on the complete set, so a
 * new event must define an action for every saved {@link OciImageValidationStates} value.
 */
export enum OciImageValidationEvents
{
	/** The worker is reading a row before doing new work. */
	Replay = "replay",
	/** Validation passed and the registry accepted every referenced blob and the manifest. */
	ImportAccepted = "import_accepted",
	/** Validation or registry import returned one saved rejection reason. */
	AdmissionRejected = "admission_rejected",
}

/**
 * Tells the workflow what it may do after combining a saved state with an observed event.
 *
 * These actions are not persisted or returned by the API. `StoreImported` and `StoreRejected` permit
 * the one final database write, `ReturnStored` replays that answer, and `Invalid` refuses a second
 * decision after the product row is terminal.
 */
export enum OciImageValidationActions
{
	/** Run validation and import because no final product answer exists. */
	Admit = "admit",
	/** Save the imported OCI image evidence and immutable registry reference. */
	StoreImported = "store_imported",
	/** Save the bounded rejection reason. */
	StoreRejected = "store_rejected",
	/** Return the final answer already in the database. */
	ReturnStored = "return_stored",
	/** Reject an event that cannot occur from this saved state. */
	Invalid = "invalid",
}

/** Complete State by Event table for OCI image admission. */
const _TRANSITIONS: Readonly<Record<OciImageValidationStates, Readonly<Record<OciImageValidationEvents, OciImageValidationActions>>>> = {
	[OciImageValidationStates.Pending]: {
		[OciImageValidationEvents.Replay]: OciImageValidationActions.Admit,
		[OciImageValidationEvents.ImportAccepted]: OciImageValidationActions.StoreImported,
		[OciImageValidationEvents.AdmissionRejected]: OciImageValidationActions.StoreRejected,
	},
	[OciImageValidationStates.Imported]: {
		[OciImageValidationEvents.Replay]: OciImageValidationActions.ReturnStored,
		[OciImageValidationEvents.ImportAccepted]: OciImageValidationActions.Invalid,
		[OciImageValidationEvents.AdmissionRejected]: OciImageValidationActions.Invalid,
	},
	[OciImageValidationStates.Rejected]: {
		[OciImageValidationEvents.Replay]: OciImageValidationActions.ReturnStored,
		[OciImageValidationEvents.ImportAccepted]: OciImageValidationActions.Invalid,
		[OciImageValidationEvents.AdmissionRejected]: OciImageValidationActions.Invalid,
	},
};

/** Returns the state-table action that prevents a replay from writing a second final decision. */
export function __OciImageValidationTransition(state: OciImageValidationStates, event: OciImageValidationEvents): OciImageValidationActions
{
	return _TRANSITIONS[state][event];
}

/**
 * Rebuilds the workflow result from a final product row so a replay can skip artifact and registry I/O.
 * Returns `null` only for `Pending`; incomplete terminal evidence throws because it violates the
 * database state contract.
 */
export function __OciImageValidationReplayResult(record: OciImageValidationRecord): OciImageAdmissionResult | null
{
	const action = __OciImageValidationTransition(record.state, OciImageValidationEvents.Replay);
	if (action === OciImageValidationActions.Admit)
		return null;
	if (action !== OciImageValidationActions.ReturnStored)
		throw new Error("OCI image validation replay state is invalid.");
	if (record.state === OciImageValidationStates.Rejected)
	{
		if (record.failureCode === null)
			throw new Error("Rejected OCI image validation has no failure code.");
		return { accepted: false, failureCode: record.failureCode };
	}
	if (record.indexDigest === null || record.imageManifestDigest === null || record.configDigest === null || record.registryReference === null)
		throw new Error("Imported OCI image validation has incomplete evidence.");
	return { accepted: true, layout: { indexDigest: record.indexDigest, imageManifestDigest: record.imageManifestDigest, configDigest: record.configDigest, registryReference: record.registryReference } };
}
