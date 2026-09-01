import { randomUUID } from "node:crypto";

import { ComputerLeaseStates, ConversationComputerStates, type ConversationComputerExecution } from "@opencrane/contracts";

import { ConversationComputerHistory } from "./conversation-computer-history";
import type { CurrentConversationComputer } from "./conversation-computer-history.types";
import { ConversationComputerExecutionStartOutcomes, type ConversationComputerExecutionClock, type ConversationComputerExecutionStartCommand, type ConversationComputerExecutionStartResult } from "./conversation-computer-execution-authority.types";

/**
 * Appends the one server-owned execution that makes a warm ConversationComputer eligible for a loop.
 *
 * A SandboxClaim becoming ready grants isolated compute, not the right to choose an execution. This
 * authority reloads the server-owned computer stream, checks that its active lease has not expired,
 * and appends a generated execution under that stream revision. A competing response-lost start
 * reloads the durable winner and reuses it; a cold, replaced, expired, or terminal computer remains
 * unavailable.
 *
 * Called by: the future ConversationComputer loop composition.
 * @see ConversationComputerHistory
 */
export class ConversationComputerExecutionAuthority
{
	/** Connects execution admission to history and the server-owned lease clock. */
	public constructor(
		private readonly history: Pick<ConversationComputerHistory, "append" | "loadForActivation">,
		private readonly clock: ConversationComputerExecutionClock,
	)
	{
	}

	/**
	 * Returns the current execution or appends one under the currently observed warm lease.
	 *
	 * Called by: the future ConversationComputer loop composition.
	 * @param command - Supplies a durable activation locator whose history replay derives profile and identity.
	 * @returns The one execution the loop may use, or `Unavailable` when no current lease permits contact.
	 * @throws {Error} Propagates history read and append failures when no durable concurrent winner exists.
	 */
	public async start(command: ConversationComputerExecutionStartCommand): Promise<ConversationComputerExecutionStartResult>
	{
		// 1. Read history first so neither the caller nor a ready SandboxClaim can select execution facts.
		const current = await this.history.loadForActivation(command);
		const now = _Now(this.clock);
		const existing = _OpenExecution(current, now);
		if (existing !== null)
			return { outcome: ConversationComputerExecutionStartOutcomes.AlreadyActive, execution: existing };
		if (!_MayStart(current, now))
			return { outcome: ConversationComputerExecutionStartOutcomes.Unavailable, execution: null };

		// 2. Append the generated execution at this head so another start cannot replace its lease fence.
		const execution = _Execution(current, now);
		try
		{
			await this.history.append({
				expectedRevision: current.revision,
				eventId: randomUUID(),
				computer: { ...current.computer, activeExecution: execution, updatedAt: now.toISOString() },
				lease: current.lease,
			});
			return { outcome: ConversationComputerExecutionStartOutcomes.Started, execution };
		}
		catch (error: unknown)
		{
			// 3. Reload after an append loss so a response-lost concurrent start returns the stored winner.
			const reloaded = await this.history.loadForActivation(command);
			const winner = _OpenExecution(reloaded, _Now(this.clock));
			if (winner !== null)
				return { outcome: ConversationComputerExecutionStartOutcomes.AlreadyActive, execution: winner };
			throw error;
		}
	}
}

/** Reads a usable server time after I/O has finished so a lease cannot cross expiry during admission. */
function _Now(clock: ConversationComputerExecutionClock): Date
{
	const now = clock.now();
	if (!Number.isFinite(now.getTime()))
		throw new Error("Conversation computer execution requires a valid server clock");
	return now;
}

/** Returns the current open execution only when the checked lease is still usable at server time. */
function _OpenExecution(current: CurrentConversationComputer | null, now: Date): ConversationComputerExecution | null
{
	if (!_HasActiveWarmLease(current, now) || current.computer.activeExecution === null || current.computer.activeExecution.endedAt !== null)
		return null;
	return current.computer.activeExecution;
}

/** Allows a start only when the active lease has no retained terminal execution. */
function _MayStart(current: CurrentConversationComputer | null, now: Date): current is CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }
{
	return _HasActiveWarmLease(current, now) && current.computer.activeExecution === null;
}

/** Checks the complete lifecycle and clock fence needed before a server appends an execution. */
function _HasActiveWarmLease(current: CurrentConversationComputer | null, now: Date): current is CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }
{
	return current !== null
		&& current.computer.state === ConversationComputerStates.Warm
		&& current.lease !== null
		&& current.lease.state === ComputerLeaseStates.Active
		&& Date.parse(current.lease.expiresAt) > now.getTime();
}

/** Builds an execution identity that only the server creates after it has checked one active lease. */
function _Execution(current: CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }, now: Date): ConversationComputerExecution
{
	return {
		id: randomUUID(),
		leaseId: current.lease.id,
		leaseGeneration: current.lease.generation,
		startedAt: now.toISOString(),
		endedAt: null,
	};
}
