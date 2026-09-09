import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { ConversationComputerToolResultOutcomes } from "./conversation-computer-continuation.types";
import type { ConversationComputerTurnAuthorityDependencies, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/**
 * Recheck current history, Pod and selected-tool authority before a new answer is physically appended.
 * A saved intent does not replace these checks. BoundConversationWriter calls this only for an empty
 * output slot; exact already-accepted history remains recoverable after later authority loss.
 * Called by: output preparation and the composed bound writer's append fence.
 * @returns The current deadline, shortened by the selected tool result's authority when applicable.
 * @throws Error when current access, the original result digest or its authority deadline fails.
 */
export async function __AssertConversationComputerAnswerAuthority(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity, dependencies: Pick<ConversationComputerTurnAuthorityDependencies, "candidates" | "toolResults">): Promise<number>
{
	const current = await dependencies.candidates.assertCurrent(turn, workload);
	let notAfter = Date.parse(current.credentialExpiresAt);
	if (turn.toolSelection !== null)
	{
		const result = await dependencies.toolResults.read(turn, workload);
		if (result.outcome !== ConversationComputerToolResultOutcomes.Available || result.payloadDigest !== turn.continuationReservation?.resultDigest)
			throw new Error("Conversation tool authority ended before answer append");
		notAfter = Math.min(notAfter, result.notAfterEpochMs);
	}
	if (!Number.isSafeInteger(notAfter) || notAfter <= Date.now())
		throw new Error("Conversation answer authority expired before append");
	return notAfter;
}
