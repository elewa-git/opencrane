import type { ConversationComputer } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationComputerHistory } from "./conversation-computer-history";
import type { CurrentConversationComputer } from "./conversation-computer-history.types";
import { _ConversationComputerProvisionRecoveryOutcomes, type _ConversationComputerProvisionRecoveryCommand, type _ConversationComputerProvisionRecoveryResult } from "./conversation-computer-provision-recovery.types";

/**
 * Recovers a cold-computer provision when KurrentDB may have committed it without acknowledging it.
 *
 * A future history-anchored creation projector calls this after its reservation freezes the computer
 * and event identifier. A duplicate or a lost response can leave the provision append ambiguous, so
 * this authority reloads the computer through those frozen coordinates. It reports recovery only for
 * revision zero, no lease, and the same canonical JSON snapshot; every other stream rethrows the
 * original provision failure.
 *
 * @see ConversationComputerHistory.provision
 */
export class _ConversationComputerProvisionRecovery
{
	/** Connects provision recovery to the narrow computer-history operations it needs. */
	public constructor(private readonly history: Pick<ConversationComputerHistory, "load" | "provision">)
	{
	}

	/**
	 * Provisions one cold computer and recovers only when history proves the same revision-zero record.
	 *
	 * @param command - Supplies the event key and cold snapshot frozen in the creation reservation.
	 * @returns Whether KurrentDB acknowledged the provision or history recovered its cold revision-zero record.
	 * @throws {Error} Rethrows the provision failure unless history proves the exact cold revision-zero record.
	 */
	public async provision(command: _ConversationComputerProvisionRecoveryCommand): Promise<_ConversationComputerProvisionRecoveryResult>
	{
		try
		{
			await this.history.provision(command);
			return { outcome: _ConversationComputerProvisionRecoveryOutcomes.Provisioned };
		}
		catch (error: unknown)
		{
			const current = await this.history.load(_CurrentCommand(command.computer));
			if (_IsExactColdProvision(current, command.computer))
				return { outcome: _ConversationComputerProvisionRecoveryOutcomes.Recovered };
			throw error;
		}
	}
}

/** Builds the history locator from the coordinates that the creation reservation froze. */
function _CurrentCommand(computer: ConversationComputer)
{
	return {
		siloId: computer.siloId,
		computerId: computer.id,
		conversationId: computer.conversationId,
		agentIdentityId: computer.agentIdentityId,
		profileRevisionId: computer.profileRevisionId,
	};
}

/** Checks that the reloaded snapshot is the same cold provision that this call requested. */
function _IsExactColdProvision(current: CurrentConversationComputer | null, computer: ConversationComputer): boolean
{
	return current !== null
		&& current.revision === 0n
		&& current.lease === null
		&& ___DigestCanonicalJson(current.computer as unknown as JsonValue) === ___DigestCanonicalJson(computer as unknown as JsonValue);
}
