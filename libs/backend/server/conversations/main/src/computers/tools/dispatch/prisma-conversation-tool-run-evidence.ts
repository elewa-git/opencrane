import { AgentRunState, type Prisma } from "@prisma/client";

import { __DigestCanonicalJson, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationToolRunEvidence, ConversationToolRunEvidenceReader } from "./conversation-tool-dispatch-evidence.types";

/** Checks the saved invocation against the running attempt and its original budget. */
export class PrismaConversationToolRunEvidenceRepository implements ConversationToolRunEvidenceReader
{
	/** Use the transaction that will also check permissions and claim or acknowledge the invocation. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Reject changed inputs before reading current identity history or recording permission decisions. */
	public async load(invocation: ToolInvocationRecord, now: Date): Promise<ConversationToolRunEvidence | null>
	{
		const evidence = invocation.authorizationEvidence;
		if (invocation.mcpTaskId !== null || invocation.runId === null || invocation.attempt === null || invocation.agentRevisionId === null
			|| evidence === null || !("executionSubject" in evidence))
			return null;
		if (invocation.effectiveArguments === null || invocation.effectiveArgumentsDigest === null)
			return null;
		const argumentsDigest = __DigestCanonicalJson(invocation.effectiveArguments);
		if (argumentsDigest !== invocation.effectiveArgumentsDigest)
			return null;
		const subject = evidence.executionSubject;
		const scope = subject.runScope;
		if (scope.runId !== invocation.runId || scope.attempt !== invocation.attempt || scope.siloId !== invocation.siloId
			|| scope.agentRevisionId !== invocation.agentRevisionId || Date.parse(subject.membership.trustedUntil) <= now.getTime()
			|| Date.parse(subject.requester.membership.trustedUntil) <= now.getTime())
			return null;

		const run = await this.transaction.agentRun.findFirst({
			where: {
				id: invocation.runId, siloId: invocation.siloId, attempt: invocation.attempt, state: AgentRunState.Running,
				agentServiceId: scope.agentServiceId, agentRevisionId: scope.agentRevisionId,
				agentIdentityId: subject.agentIdentityId, principalId: subject.principalId,
			},
			select: { conversationId: true, executionSubject: true, inputSnapshotDigest: true },
		});
		if (run === null || run.conversationId === null || ___DigestCanonicalJson(run.executionSubject as JsonValue) !== ___DigestCanonicalJson(subject as unknown as JsonValue))
			return null;
		const snapshot = await this.transaction.runInputSnapshot.findFirst({
			where: {
				runId: invocation.runId, attempt: invocation.attempt, digest: run.inputSnapshotDigest,
				siloId: invocation.siloId, agentRevisionId: invocation.agentRevisionId,
				agentIdentityId: subject.agentIdentityId, principalId: subject.principalId,
			},
			select: { budgetPolicy: true },
		});
		const budget = snapshot?.budgetPolicy;
		if (budget === null || typeof budget !== "object" || Array.isArray(budget))
			return null;
		const deadline = budget.wallClockDeadlineEpochMs;
		const toolLimit = budget.maxToolInvocations;
		if (typeof deadline !== "number" || !Number.isSafeInteger(deadline) || deadline <= now.getTime()
			|| (toolLimit !== undefined && toolLimit !== null && (typeof toolLimit !== "number" || !Number.isSafeInteger(toolLimit) || toolLimit < 1)))
			return null;
		// This invocation is already counted, so equality with the allowance is still valid.
		if (typeof toolLimit === "number" && await this.transaction.toolInvocation.count({ where: { runId: invocation.runId, attempt: invocation.attempt } }) > toolLimit)
			return null;
		return {
			siloId: invocation.siloId, conversationId: run.conversationId, toolRevisionId: invocation.toolRevisionId,
			subject, authorization: evidence, argumentsDigest, deadlineEpochMs: deadline,
		};
	}
}
