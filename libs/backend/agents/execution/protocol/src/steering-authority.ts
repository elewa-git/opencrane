import { createHash } from "node:crypto";

import type { AdmitModelTerminalCommand, AdmitModelTerminalResult, ClaimSteeringBoundaryCommand, ClaimSteeringBoundaryResult, SteeringBoundaryClaim, SteeringBoundaryRepository, SteeringDisposition } from "./steering-authority.types.js";

/** Derive the deterministic boundary id so a reconnecting runtime claims the exact same boundary. */
function _boundaryId(runId: string, attempt: number, fromInputGeneration: number): string
{
	const canonical = JSON.stringify(["opencrane-steering-boundary-v1", runId, attempt, fromInputGeneration]);
	return `boundary-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/**
 * Claim the next ordered steering boundary for an attempt, absorbing or deferring exactly once.
 *
 * Steering is absorbed only at a safe pre-model boundary: the runtime calls this immediately before
 * issuing a model request, identifying the boundary by a deterministic id derived from the run,
 * attempt, and the generation it is advancing from. Absorbing buffered steering advances the input
 * generation by one; a boundary with nothing buffered is recorded as a deferral and leaves the
 * generation unchanged. The recording is exactly-once through an INJECTED
 * {@link SteeringBoundaryRepository}: if a prior process already claimed this boundary — whether it
 * died before or after acknowledging its claim — the previously recorded disposition is replayed
 * rather than a second absorb/defer being emitted, so steering can never be double-applied.
 *
 * @param repository - Durable exactly-once boundary-claim authority.
 * @param command - Run attempt, the source generation, and any buffered steering.
 * @returns The disposition and resulting generation in force, and whether it was a replay.
 */
export async function __ClaimSteeringBoundary(repository: SteeringBoundaryRepository, command: ClaimSteeringBoundaryCommand): Promise<ClaimSteeringBoundaryResult>
{
	const disposition: SteeringDisposition = command.pendingSteering !== null ? "absorbed" : "deferred";
	const boundaryId = _boundaryId(command.runId, command.attempt, command.fromInputGeneration);
	const toInputGeneration = disposition === "absorbed" ? command.fromInputGeneration + 1 : command.fromInputGeneration;
	const claim: SteeringBoundaryClaim = {
		runId: command.runId,
		attempt: command.attempt,
		boundaryId,
		fromInputGeneration: command.fromInputGeneration,
		toInputGeneration,
		disposition,
		steeringDigest: command.pendingSteering?.steeringDigest ?? null,
	};
	const recorded = await repository.claim(claim);
	if (recorded.status === "existing") return { boundaryId, disposition: recorded.disposition, toInputGeneration: recorded.toInputGeneration, replayed: true };
	return { boundaryId, disposition, toInputGeneration, replayed: false };
}

/**
 * Admit a model terminal only when it was produced under the attempt's current input generation.
 * A terminal carrying a superseded generation raced an absorbed steering boundary and is rejected so
 * stale model output can never close or advance a run whose input has already moved on.
 * @param command - The attempt's current generation and the generation the terminal was produced under.
 * @returns Acceptance, or a stale-generation rejection.
 */
export function __AdmitModelTerminal(command: AdmitModelTerminalCommand): AdmitModelTerminalResult
{
	if (command.terminalInputGeneration !== command.currentInputGeneration) return { outcome: "rejected", reason: "stale_input_generation" };
	return { outcome: "accepted" };
}
