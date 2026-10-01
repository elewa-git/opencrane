import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, ConversationComputerStopStatuses, type ConversationComputerStopAdmission, type ConversationComputerStopAdmissionAuthority, type ConversationComputerStopAuthority, type ConversationComputerStopCommand, type ConversationComputerStopOutcome, type ConversationComputerStopPublisher, type ConversationComputerStopPublishOutcome, type ConversationComputerStopTargetReader } from "./conversation-computer-stop.types";
import { ConversationComputerStopDenied } from "./conversation-computer-stop-denied";

/** Resolves one immutable Stop event and hands target cleanup to the admitted Absurd task. */
export class _ConversationComputerStopAuthority implements ConversationComputerStopAuthority
{
	/** Connects replay recovery, current target resolution and SQL admission. */
	public constructor(private readonly admissions: ConversationComputerStopAdmissionAuthority, private readonly targets: ConversationComputerStopTargetReader, private readonly publisher: ConversationComputerStopPublisher) {}

	/** Never starts replacement work; a target result means only that durable cancellation was admitted. */
	public async stop(command: ConversationComputerStopCommand): Promise<ConversationComputerStopOutcome>
	{
		try { return await this._Stop(command); }
		catch (error)
		{
			if (error instanceof ConversationComputerStopDenied)
				return { status: ConversationComputerStopStatuses.Denied };
			throw error;
		}
	}

	/** Executes one Stop while allowing permanent authority refusals to remain typed. */
	private async _Stop(command: ConversationComputerStopCommand): Promise<ConversationComputerStopOutcome>
	{
		const recovered = await this.publisher.recover(command);
		if (recovered !== null)
			return _PublishedOutcome(recovered, true);
		const saved = await this.admissions.read(command);
		if (saved !== null)
			return { status: ConversationComputerStopStatuses.Idempotent };
		for (let attempt = 0; attempt < 8; attempt += 1)
		{
			let selection = await this.publisher.recoverSelection(command);
			if (selection === null)
			{
				const resolved = await this.targets.resolve(command);
				if (resolved === null)
					return { status: ConversationComputerStopStatuses.Denied };
				selection = await this.publisher.select(command, resolved);
				if (selection === null)
					continue;
			}
			if (selection.kind === ConversationComputerStopAdmissionKinds.Target)
			{
				await this.admissions.admit(command, selection);
				return { status: ConversationComputerStopStatuses.Accepted };
			}
			const terminal = await this.publisher.recover(command);
			if (terminal === null)
				throw new Error("conversation Stop no-target selection omitted its terminal receipt");
			return _PublishedOutcome(terminal, false);
		}
		throw new Error("conversation Stop target selection remained contended");
	}
}

/** Maps an immutable Kurrent receipt into the consumer-facing operation result. */
function _PublishedOutcome(outcome: ConversationComputerStopPublishOutcome, recovered: boolean): ConversationComputerStopOutcome
{
	if (outcome.decision === ConversationComputerStopDecisions.Stale)
		return { status: ConversationComputerStopStatuses.Denied };
	if (outcome.decision === ConversationComputerStopDecisions.NoTarget)
		return { status: recovered ? ConversationComputerStopStatuses.Idempotent : ConversationComputerStopStatuses.NothingToStop };
	if (outcome.decision === ConversationComputerStopDecisions.CancellationWon)
		return { status: recovered ? ConversationComputerStopStatuses.Idempotent : ConversationComputerStopStatuses.Stopped };
	return { status: ConversationComputerStopStatuses.Idempotent };
}
