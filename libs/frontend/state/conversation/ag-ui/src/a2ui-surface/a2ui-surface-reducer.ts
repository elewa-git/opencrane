import type { AgUiA2uiEnvelope } from "@opencrane/contracts";

import type { AgUiStreamState } from "../ag-ui-stream.types";

/** Most operations kept for one surface; a surface that exceeds this makes the reducer throw. */
const _MAX_MATERIALIZED_A2UI_OPERATIONS = 256;

/**
 * Accepts one A2UI surface envelope, keyed by the four ids that identify the surface.
 *
 * Operations accumulate: a new envelope's operations are appended to what is already stored, so a
 * surface builds up as it streams. The sequence must advance by exactly one — going backwards,
 * skipping, or exceeding {@link _MAX_MATERIALIZED_A2UI_OPERATIONS} all throw. Re-sending the same
 * sequence is accepted only when the payload is byte-identical; a changed payload at the same
 * sequence throws, which is what `surfaceFingerprints` exists to detect.
 */
export function _A2uiSurface(state: AgUiStreamState, envelope: AgUiA2uiEnvelope, name: string): AgUiStreamState
{
	const identity = _A2uiSurfaceIdentity(envelope);
	const previous = state.surfaces.get(identity);
	const fingerprint = JSON.stringify(envelope);
	const previousFingerprint = state.surfaceFingerprints.get(identity);
	if (previous !== undefined && envelope.sequence < previous.sequence) throw new Error("governed A2UI surface sequence regressed");
	if (previous !== undefined && envelope.sequence > previous.sequence + 1) throw new Error("governed A2UI surface sequence has a gap");
	if (previous !== undefined && envelope.sequence === previous.sequence)
	{
		if (previousFingerprint !== fingerprint) throw new Error("governed A2UI surface sequence changed payload");
		return state;
	}
	const materialized = previous === undefined ? envelope : { ...envelope, operations: [...previous.operations, ...envelope.operations] };
	if (materialized.operations.length > _MAX_MATERIALIZED_A2UI_OPERATIONS) throw new Error("governed A2UI surface history is too large");
	return {
		...state,
		surfaces: new Map(state.surfaces).set(identity, materialized),
		surfaceFingerprints: new Map(state.surfaceFingerprints).set(identity, fingerprint),
		customEvents: [...state.customEvents, name]
	};
}

/** Build the map key for a surface from its conversation, run, message and surface ids. */
function _A2uiSurfaceIdentity(envelope: AgUiA2uiEnvelope): string
{
	return JSON.stringify([envelope.conversationId, envelope.runId, envelope.messageId, envelope.surfaceId]);
}
