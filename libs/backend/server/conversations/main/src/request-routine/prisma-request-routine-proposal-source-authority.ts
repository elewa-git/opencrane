import { AgentRunState, AgentRunTrigger, ConversationLifecycle, OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";

import type { RequestRoutineProposalSource, RequestRoutineProposalSourceAuthority } from "@opencrane/backend/server/agents/scheduling/contract";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { FirstPartyToolCapabilities, RUN_INPUT_SNAPSHOT_VERSION, ___ExecutionSubjectSchema, ___ParseRunBudgetPolicy, ___RunInputFirstPartyCapabilitySelectionsSchema } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { REQUEST_ROUTINE_TOOL } from "@opencrane/backend/server/agents/scheduling/contract";

/** Proves scheduling proposal source facts inside the scheduling-owned write transaction. */
export class PrismaRequestRoutineProposalSourceAuthority implements RequestRoutineProposalSourceAuthority
{
	public constructor(private readonly _transaction: Prisma.TransactionClient) {}

	/** Requires the exact active interactive run, frozen capability and current requester access. */
	public async authorizeCreation(source: RequestRoutineProposalSource): Promise<RequestRoutineProposalSource | null>
	{
		const now = (await this._transaction.agentRunAuthorityClock.findUniqueOrThrow({ where: { singleton: 1 }, select: { now: true } })).now;
		const run = await this._transaction.agentRun.findFirst({ where: { id: source.runId, siloId: source.siloId, conversationId: source.sourceConversationId, attempt: source.attempt, trigger: AgentRunTrigger.Interactive, state: AgentRunState.Running }, select: { executionSubject: true, inputSnapshotDigest: true } });
		if (run === null)
			return null;
		const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
		if (!subject.success || subject.data.requester.requesterPrincipalId !== source.requesterPrincipalId || Date.parse(subject.data.requester.membership.trustedUntil) <= now.getTime())
			return null;
		const snapshot = await this._transaction.runInputSnapshot.findFirst({ where: { runId: source.runId, attempt: source.attempt, digest: run.inputSnapshotDigest, siloId: source.siloId, conversationId: source.sourceConversationId }, select: { snapshotVersion: true, firstPartyCapabilities: true, budgetPolicy: true } });
		if (snapshot === null || snapshot.snapshotVersion !== RUN_INPUT_SNAPSHOT_VERSION || ___ParseRunBudgetPolicy(snapshot.budgetPolicy).wallClockDeadlineEpochMs <= now.getTime())
			return null;
		const capabilities = ___RunInputFirstPartyCapabilitySelectionsSchema.safeParse(snapshot.firstPartyCapabilities);
		if (!capabilities.success || capabilities.data.filter(value => value.capability === FirstPartyToolCapabilities.RequestRoutine && value.capabilityRevision === REQUEST_ROUTINE_TOOL.capabilityRevision && value.parametersSchemaDigest === REQUEST_ROUTINE_TOOL.parametersSchemaDigest).length !== 1)
			return null;
		return await this._CurrentRequester(source, now) ? source : null;
	}

	/** Rechecks only current requester participation and readability after the run has ended. */
	public async authorizeRequesterAccess(source: RequestRoutineProposalSource): Promise<RequestRoutineProposalSource | null>
	{
		const now = (await this._transaction.agentRunAuthorityClock.findUniqueOrThrow({ where: { singleton: 1 }, select: { now: true } })).now;
		return await this._CurrentRequester(source, now) ? source : null;
	}

	private async _CurrentRequester(source: RequestRoutineProposalSource, now: Date): Promise<boolean>
	{
		const principal = await this._transaction.principal.findFirst({ where: { id: source.requesterPrincipalId, siloId: source.siloId, provenance: PrincipalProvenance.External }, select: { subject: true } });
		if (principal === null)
			return false;
		const membership = await this._transaction.orgMembership.findFirst({ where: { clusterTenant: source.siloId, subject: principal.subject, status: OrgMemberStatus.Active }, select: { id: true } });
		const conversation = await this._transaction.conversation.findFirst({ where: { id: source.sourceConversationId, siloId: source.siloId, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: principal.subject, accessEndedPosition: null } } }, select: { id: true } });
		if (membership === null || conversation === null)
			return false;
		const decision = await new PrismaAuthorizationAuthority(this._transaction).decidePrincipal({ siloId: source.siloId, principalId: source.requesterPrincipalId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: source.sourceConversationId }, action: ProductAuthorizationActions.Read, nowEpochMs: now.getTime() });
		return decision.outcome === AuthorizationDecisionOutcomes.Allow;
	}
}
