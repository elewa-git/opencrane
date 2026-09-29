import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { RoutineComputerActivationStatus, type RoutineComputerActivationPort, type RoutineComputerActivationResult, type RoutineOccurrenceCommand, type RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { ConversationComputerHistory, type CurrentConversationComputer } from "@opencrane/backend/server/conversations/computers";

import { ConversationComputerActivationAuthorityAdapter } from "../computers/activation/conversation-computer-activation-authority";
import { ConversationComputerActivationQueueActions } from "../computers/activation/conversation-computer-activation.types";
import { RoutineActivationRefusedError } from "./routine-activation-refused";
import { _AssertRoutineActivationComputer, _AssertRoutineActivationHistory, _AssertRoutineActivationReplay, _RoutineActivationCommand, _RoutineActivationEnded } from "./routine-computer-activation.mapper";
import type { RoutineComputerActivationDependencies } from "./routine-computer-activation.types";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/**
 * Activates a prepared occurrence through the shared computer lifecycle, without admitting a run.
 * Normal cold starts return Pending for durable workflow sleep. Only committed scheduling refusals
 * return Refused; inconsistent history and unavailable dependencies remain errors.
 */
export class RoutineComputerActivation implements RoutineComputerActivationPort
{
	/** Reads the same computer aggregate that the shared activation authority updates. */
	private readonly computers: ConversationComputerHistory;

	/** Receives deployment-selected runtime settings and the existing authority owners. */
	public constructor(private readonly dependencies: RoutineComputerActivationDependencies)
	{
		this.computers = new ConversationComputerHistory(dependencies.history);
	}

	/** Runs a single cold-start poll; no instruction content enters the trace or the activation command. */
	public activate(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineComputerActivationResult>
	{
		const self = this;
		return ___DoWithTrace("routine.computer_activate", { siloId: command.siloId, firingId: command.firingId, conversationId: command.conversationId }, async function _Activate(): Promise<RoutineComputerActivationResult>
		{
			try
			{
				return await self._activate(command, preparation);
			}
			catch (error)
			{
				if (error instanceof RoutineActivationRefusedError)
					return { status: RoutineComputerActivationStatus.Refused };
				throw error;
			}
		});
	}

	/** Verifies immutable instruction evidence before requesting the original computer generation. */
	private async _activate(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineComputerActivationResult>
	{
		const record = await this.dependencies.occurrences.readRecord(command.siloId, command.conversationId);
		_AssertRoutineActivationHistory(command, preparation, record);
		const projections = this.dependencies.projections(command, preparation, record);
		const saved = await projections.authorize();
		const current = await this._current(record);
		if (_RoutineActivationEnded(current, Date.now()))
			await projections.refuse();
		if (saved !== null)
			_AssertRoutineActivationReplay(saved, record, preparation, current);
		const self = this;
		const claims = {
			claim: async function _Claim(input: Parameters<RoutineComputerActivationDependencies["claims"]["claim"]>[0])
			{
				if (await projections.authorize() !== null)
					throw new Error("Published routine activation cannot request another sandbox claim");
				if (Date.parse(input.expiresAt) <= Date.now())
					await projections.refuse();
				return await self.dependencies.claims.claim(input);
			},
		};
		const authority = new ConversationComputerActivationAuthorityAdapter(projections, this.dependencies.history, claims, this.dependencies.profile);
		const outcome = await authority.activate(_RoutineActivationCommand(record));
		if (outcome === "denied")
			throw new Error("Prepared routine computer activation was unexpectedly denied");
		if (typeof outcome === "object")
		{
			if (outcome.action === ConversationComputerActivationQueueActions.Park)
				await projections.refuse();
			const pending = await this._current(record);
			if (_RoutineActivationEnded(pending, Date.now()))
				await projections.refuse();
			if (pending.computer.state !== ConversationComputerStates.ClaimPending || pending.lease?.state !== ComputerLeaseStates.Claimed)
				throw new Error("Routine activation pending result differs from computer history");
			const expiresAtEpochMs = Date.parse(pending.lease.expiresAt);
			if (expiresAtEpochMs <= Date.now())
				await projections.refuse();
			return { status: RoutineComputerActivationStatus.Pending, notBeforeEpochMs: Math.min(Date.now() + 5_000, expiresAtEpochMs), expiresAtEpochMs };
		}
		if (projections.receipt === null)
			throw new Error("Routine activation did not commit its lease and receipt");
		return { status: RoutineComputerActivationStatus.Active, receipt: projections.receipt };
	}

	/** Loads only the initial computer prepared for this occurrence; never allocates a replacement. */
	private async _current(record: RoutineOccurrenceHistoryRecord): Promise<CurrentConversationComputer>
	{
		const current = await this.computers.load({ computer: { siloId: record.siloId, conversationId: record.conversationId, computerId: record.computerId, agentIdentityId: record.agentIdentityId }, profileRevisionId: record.profileRevisionId });
		_AssertRoutineActivationComputer(current);
		return current;
	}
}
