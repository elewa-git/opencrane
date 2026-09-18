import { ConversationComputerToolResultOutcomes } from "./conversation-computer-continuation.types";
import { ConversationComputerRealizationKinds } from "@opencrane/contracts";
import type { ConversationComputerProcessIdentity } from "./conversation-computer-realization.types";
import type { ConversationComputerTurnAuthorityDependencies, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/**
 * Recheck current history, process binding and selected-tool authority before appending a new answer.
 * A saved intent does not replace these checks. BoundConversationWriter calls this only for an empty
 * output slot; exact already-accepted history remains recoverable after later authority loss.
 * Tool-result checks remain Agent Sandbox-specific because their authority includes Kubernetes
 * workload evidence; host development cannot invoke that path.
 * Called by: output preparation and the composed bound writer's append fence.
 * @returns The current deadline, shortened by the selected tool result's authority when applicable.
 * @throws Error when current access, the original result digest or its authority deadline fails.
 */
export async function __AssertConversationComputerAnswerAuthority(turn: FrozenConversationComputerTurn, process: ConversationComputerProcessIdentity, dependencies: Pick<ConversationComputerTurnAuthorityDependencies, "candidates" | "toolResults">): Promise<number>
{
	const current = await dependencies.candidates.assertCurrent(turn, process);
	let notAfter = Date.parse(current.credentialExpiresAt);
	if (turn.toolSelection !== null)
	{
		if (process.kind !== ConversationComputerRealizationKinds.AgentSandbox)
			throw new Error("Host development conversation computers cannot read production tool results");
		const result = await dependencies.toolResults.read(turn, process.workload);
		if (result.outcome !== ConversationComputerToolResultOutcomes.Available || result.payloadDigest !== turn.continuationReservation?.resultDigest)
			throw new Error("Conversation tool authority ended before answer append");
		notAfter = Math.min(notAfter, result.notAfterEpochMs);
	}
	if (!Number.isSafeInteger(notAfter) || notAfter <= Date.now())
		throw new Error("Conversation answer authority expired before append");
	return notAfter;
}
