import { createHash } from "node:crypto";

import type { AdmitModelTerminalCommand, AdmitModelTerminalResult, ClaimSteeringBoundaryCommand, ClaimSteeringBoundaryResult, SteeringBoundaryClaim, SteeringBoundaryRepository, SteeringDisposition } from "./steering-authority.types";

/** Derive the deterministic boundary id so a reconnecting runtime claims the exact same boundary. */
function _boundaryId(runId: string, attempt: number, fromInputGeneration: number): string
{
	const canonical = JSON.stringify(["opencrane-steering-boundary-v1", runId, attempt, fromInputGeneration]);
	return `boundary-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/**
 * Claim the next steering boundary for an attempt, absorbing or deferring exactly once.
 *
 * Steering is only applied at a safe point before a model request: the runtime calls this just
 * before issuing one, and names the boundary with an id worked out from the run, the attempt, and
 * the generation it is moving on from. Absorbing waiting steering raises the input generation by
 * one; a boundary with nothing waiting is written as a deferral and leaves the generation alone.
 *
 * The injected {@link SteeringBoundaryRepository} makes the write happen only once: if an earlier
 * process already claimed this boundary - whether it died before or after acknowledging the claim -
 * the decision already written is returned, instead of a second absorb or defer, so steering can
 * never be applied twice.
 *
 * Called by: no callers found. Nothing outside this package imports it, and index.ts does not
 * re-export steering-authority.js, so the runtime side of this protocol is not wired up yet.
 *
 * @param repository - Durable exactly-once boundary-claim authority.
 * @param command - Run attempt, the generation being moved on from, and any waiting steering.
 * @returns The disposition and the generation now in force, plus `replayed: true` when an earlier
 * process had already recorded this boundary. A replay obliges the caller to use the returned
 * generation, not the one it calculated.
 * @throws Whatever the repository throws when it cannot record the boundary.
 * @see __AdmitModelTerminal which uses the resulting generation.
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
 * Accept a finished model response only when it was produced under the attempt's current input
 * generation.
 *
 * A response carrying an older generation lost a race with a boundary that absorbed steering: the
 * model answered a question the user has already changed. Rejecting it is what stops out-of-date
 * output from finishing or advancing a run whose input has moved on.
 *
 * Called by: no callers found. Nothing outside this package imports it, and index.ts does not
 * re-export steering-authority.js.
 *
 * @param command - The attempt's current generation, and the generation the response was produced
 * under.
 * @returns `accepted` - the response may be applied. `rejected` with `stale_input_generation` - it
 * must be discarded and the model asked again from the current generation, never merged.
 * @see SteeringDisposition for how a generation advances.
 */
export function __AdmitModelTerminal(command: AdmitModelTerminalCommand): AdmitModelTerminalResult
{
	if (command.terminalInputGeneration !== command.currentInputGeneration) return { outcome: "rejected", reason: "stale_input_generation" };
	return { outcome: "accepted" };
}
