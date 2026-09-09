import { createHash } from "node:crypto";

import type { ConversationToolProposal } from "@opencrane/contracts";
import { __ValidateDeferredToolArguments } from "@opencrane/backend/server/iam/authorization";
import { ___CloneCanonicalJson, ___DigestCanonicalJson } from "@opencrane/util";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import { ConversationToolProposalRefusal } from "./conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals, type PreparedConversationToolProposal } from "./conversation-tool-proposal.types";

/**
 * Validates the exact compiled tool and derives one stable slot for the original run attempt.
 *
 * The fingerprint excludes observation time and fresh permission receipts so an identical retry
 * recovers its original row. A different bootstrap, lease, tool or argument body conflicts.
 * Called by: PrismaConversationToolProposalUnitOfWork before opening its admission transaction.
 */
export function _PrepareConversationToolProposal(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: ConversationToolProposal): PreparedConversationToolProposal
{
	const input = candidate.compiledInput;
	const tool = input.tools.find(item => item.toolRevisionId === proposal.toolRevisionId);
	if (turn.outputSourceCommandId !== null || proposal.bootstrapId !== turn.bootstrapId || input.digest !== turn.compile.digest
		|| input.runId !== turn.compile.runId || input.attempt !== turn.compile.attempt || candidate.binding.expectedRevision !== turn.binding.expectedRevision
		|| tool === undefined || tool.requiresApproval || ___DigestCanonicalJson(tool.parametersSchema) !== tool.parametersSchemaDigest
		|| !__ValidateDeferredToolArguments(tool.parametersSchema, proposal.arguments))
		throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Invalid);
	const deadline = input.budget.wallClockDeadlineEpochMs;
	if (deadline === null || !Number.isSafeInteger(deadline) || deadline <= Date.now()
		|| (input.budget.maxToolInvocations !== null && (!Number.isSafeInteger(input.budget.maxToolInvocations) || input.budget.maxToolInvocations < 1)))
		throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
	const hex = createHash("sha256").update(JSON.stringify(["conversation-tool-proposal", turn.compile.runId, turn.compile.attempt, 1])).digest("hex");
	const proposalId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
	const assignmentDigest = ___DigestCanonicalJson({ siloId: turn.siloId, conversationId: turn.binding.conversationId, computerId: turn.computerId, agentIdentityId: turn.binding.agentIdentityId, lease: { ...turn.lease }, bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt });
	const argumentsValue = ___CloneCanonicalJson(proposal.arguments) as ConversationToolProposal["arguments"];
	const argumentsDigest = ___DigestCanonicalJson(argumentsValue);
	const requestFingerprint = ___DigestCanonicalJson({ proposalId, assignmentDigest, compiledInputDigest: input.digest, toolRevisionId: tool.toolRevisionId, parametersSchemaDigest: tool.parametersSchemaDigest, argumentsDigest });
	return { proposalId, tool, arguments: argumentsValue, argumentsDigest, assignmentDigest, requestFingerprint };
}
