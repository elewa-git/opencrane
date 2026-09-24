import type { ConversationGeneratedFileContinuation } from "../tools/results/conversation-generated-file-result.types";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { ConversationComputerToolResultOutcomes } from "./conversation-computer-continuation.types";
import type { ConversationComputerAnswerAuthorityDependencies, ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/**
 * Recheck current history, Pod and selected-tool authority immediately before the turn store's atomic append.
 * A saved receipt names an already committed event and does not replace these checks for a new answer.
 * Called by: ConversationComputerTurnAuthority and the generic writer fence retained by its factory.
 * @returns The current candidate and deadline from the same check used for the physical append.
 * @throws Error when current access, the original result digest or its authority deadline fails.
 */
export async function __AssertConversationComputerAnswerAuthority(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity, dependencies: ConversationComputerAnswerAuthorityDependencies): Promise<{ readonly candidate: ConversationComputerTurnCandidate; readonly notAfterEpochMs: number; readonly generatedFile?: ConversationGeneratedFileContinuation }>
{
	const current = await dependencies.candidates.assertCurrent(turn, workload);
	let notAfter = Date.parse(current.credentialExpiresAt);
	let generatedFile: ConversationGeneratedFileContinuation | undefined;
	const resultStep = [...turn.protocol.steps].reverse().find(step => step.result !== null);
	if (resultStep !== undefined)
	{
		const result = await dependencies.toolResults.read(turn, workload);
		if (result.outcome !== ConversationComputerToolResultOutcomes.Available || result.payloadDigest !== resultStep.result?.resultDigest)
			throw new Error("Conversation tool authority ended before answer append");
		notAfter = Math.min(notAfter, result.notAfterEpochMs);
		generatedFile = result.generatedFile;
	}
	if (!Number.isSafeInteger(notAfter) || notAfter <= Date.now())
		throw new Error("Conversation answer authority expired before append");
	return { candidate: current, notAfterEpochMs: notAfter, ...(generatedFile === undefined ? {} : { generatedFile }) };
}
