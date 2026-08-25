import { McpbValidationStates } from "./mcpb-validation.types";
import type { McpbVerificationResult } from "./mcpb-validation.types";
import type { McpbValidationRecord } from "./mcpb-validation-repository.types";

/** Events interpreted against one saved MCP bundle validation state. */
export enum McpbValidationEvents
{
	/** The worker is reading a row before doing new work. */
	Replay = "replay",
	/** The verifier returned a trusted manifest and signature. */
	VerificationAccepted = "verification_accepted",
	/** The verifier returned one fixed rejection reason. */
	VerificationRejected = "verification_rejected",
}

/** Actions allowed by the MCP bundle validation state table. */
export enum McpbValidationActions
{
	/** Run the verifier because no final product answer exists. */
	Verify = "verify",
	/** Save the verified manifest and signature evidence. */
	StoreVerified = "store_verified",
	/** Save the bounded rejection reason. */
	StoreRejected = "store_rejected",
	/** Return the final answer already in the database. */
	ReturnStored = "return_stored",
	/** Reject an event that cannot occur from this saved state. */
	Invalid = "invalid",
}

/** Complete State by Event table for MCP bundle verification. */
const _TRANSITIONS: Readonly<Record<McpbValidationStates, Readonly<Record<McpbValidationEvents, McpbValidationActions>>>> = {
	[McpbValidationStates.Pending]: {
		[McpbValidationEvents.Replay]: McpbValidationActions.Verify,
		[McpbValidationEvents.VerificationAccepted]: McpbValidationActions.StoreVerified,
		[McpbValidationEvents.VerificationRejected]: McpbValidationActions.StoreRejected,
	},
	[McpbValidationStates.Verified]: {
		[McpbValidationEvents.Replay]: McpbValidationActions.ReturnStored,
		[McpbValidationEvents.VerificationAccepted]: McpbValidationActions.Invalid,
		[McpbValidationEvents.VerificationRejected]: McpbValidationActions.Invalid,
	},
	[McpbValidationStates.Rejected]: {
		[McpbValidationEvents.Replay]: McpbValidationActions.ReturnStored,
		[McpbValidationEvents.VerificationAccepted]: McpbValidationActions.Invalid,
		[McpbValidationEvents.VerificationRejected]: McpbValidationActions.Invalid,
	},
};

/** Return the only action allowed for one saved state and observed event. */
export function __McpbValidationTransition(state: McpbValidationStates, event: McpbValidationEvents): McpbValidationActions
{
	return _TRANSITIONS[state][event];
}

/** Rebuild the bounded workflow result from a final saved product record. */
export function __McpbValidationReplayResult(record: McpbValidationRecord): McpbVerificationResult | null
{
	const action = __McpbValidationTransition(record.state, McpbValidationEvents.Replay);
	if (action === McpbValidationActions.Verify)
		return null;
	if (action !== McpbValidationActions.ReturnStored)
		throw new Error("MCP bundle validation replay state is invalid.");
	if (record.state === McpbValidationStates.Rejected)
	{
		if (record.failureCode === null)
			throw new Error("Rejected MCP bundle validation has no failure code.");
		return { accepted: false, failureCode: record.failureCode };
	}
	if (record.manifestName === null || record.bundleVersion === null || record.manifestDigest === null || record.publisher === null || record.signerFingerprint === null)
		throw new Error("Verified MCP bundle validation has incomplete evidence.");
	return { accepted: true, manifest: { manifestVersion: "0.3", manifestDigest: record.manifestDigest, name: record.manifestName, version: record.bundleVersion, publisher: record.publisher, signerFingerprint: record.signerFingerprint } };
}
