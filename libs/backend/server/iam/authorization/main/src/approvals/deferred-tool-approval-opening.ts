import { AgentRunState, AgentServiceKind, ApprovalRequestState, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, McpCredentialRequirement as PrismaMcpCredentialRequirement, McpExecutionTransport, OrgMemberStatus, PrincipalProvenance, Prisma } from "@prisma/client";
import { ElicitationBodyKinds, ElicitationConnectionOwnerKinds, McpCredentialRequirement, type ElicitationApprovalBody, type ElicitationExecutionConnection } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { type JsonValue } from "@opencrane/util";
import { __DigestCanonicalJson } from "../authority/canonical-json-digest";
import { __PlanDeferredToolApprovalLifecycle } from "./deferred-tool-approval-lifecycle";
import { DeferredToolApprovalLifecycleActions, DeferredToolApprovalLifecycleEvents, DeferredToolApprovalRunStates } from "./deferred-tool-approval-lifecycle.types";
import { DeferToolRequestOutcomes, type DeferToolRequestCommand, type DeferToolRequestResult } from "./deferred-tool-approval-open.types";
import { ToolInvocationStates } from "../tool-invocations/tool-invocation-lifecycle.types";
import { __FindToolInvocationInTransaction } from "../tool-invocations/persistence/tool-invocation-transaction";
import { __ReconcileDeferredToolApprovalGrants } from "./deferred-tool-approval-grants";
import { _ApprovalExecutionSubject, _MatchesApprovalElicitation } from "./deferred-tool-approval-binding";
import { type ApprovalRunBinding } from "./deferred-tool-approval-binding.types";

const _UNSAFE_DISPLAY_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** Return whether a persisted label can be shown without terminal or direction-control characters. */
function _IsDisplayLabel(value: string, maximumLength: number): boolean
{
	return value.trim().length > 0 && value.length <= maximumLength && !_UNSAFE_DISPLAY_TEXT.test(value);
}

/** Describe the one-use invocation while identifying provider text as descriptive metadata. */
function _ApprovalConsequence(description: string | null): string
{
	const fallback = "This invokes the external tool once. No further display-safe description is available.";
	if (description === null)
		return fallback;
	const value = description.trim();
	const prefix = "This invokes the external tool once. Its saved description says: ";
	return _IsDisplayLabel(value, 2_000 - prefix.length) ? `${prefix}${value}` : fallback;
}

/** Resolves the exact assignment principal and its authenticated participant subject. */
async function _resolveAssignedPrincipal(transaction: Prisma.TransactionClient, siloId: string, principalId: string, conversationId: string): Promise<{ readonly principalId: string; readonly subjectId: string } | null>
{
	const principal = await transaction.principal.findUnique({ where: { id_siloId: { id: principalId, siloId } }, select: { id: true, subject: true, provenance: true } });
	if (principal === null || principal.provenance !== PrincipalProvenance.External)
		return null;
	const identities = await transaction.principal.count({ where: { siloId, subject: principal.subject, provenance: PrincipalProvenance.External } });
	const membership = await transaction.orgMembership.findFirst({ where: { clusterTenant: siloId, subject: principal.subject, status: OrgMemberStatus.Active }, select: { id: true } });
	const participant = await transaction.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: principal.subject } }, select: { accessEndedPosition: true } });
	if (identities !== 1 || membership === null || participant === null || participant.accessEndedPosition !== null)
		return null;
	return { principalId: principal.id, subjectId: principal.subject };
}

/** Converts the only two run states that can have open approvals into the lifecycle enum; anything else gives null. */
function _approvalRunState(state: AgentRunState): DeferredToolApprovalRunStates | null
{
	if (state === AgentRunState.Running)
		return DeferredToolApprovalRunStates.Running;
	if (state === AgentRunState.WaitingForInput)
		return DeferredToolApprovalRunStates.WaitingForInput;
	return null;
}

/** Convert the database enum into the frozen participant-facing contract enum. */
function _CredentialRequirement(value: PrismaMcpCredentialRequirement): McpCredentialRequirement
{
	switch (value)
	{
		case PrismaMcpCredentialRequirement.Credentialless:
			return McpCredentialRequirement.Credentialless;
		case PrismaMcpCredentialRequirement.PrincipalCredential:
			return McpCredentialRequirement.PrincipalCredential;
		case PrismaMcpCredentialRequirement.SharedCredential:
			return McpCredentialRequirement.SharedCredential;
	}
}

/** Resolve the exact assigned tool installation and its display-safe execution owner. */
async function _ExecutionConnection(transaction: Prisma.TransactionClient, run: ApprovalRunBinding, subject: ExecutionSubject, toolRevisionId: string): Promise<ElicitationExecutionConnection | null>
{
	if (run.agentRevisionId === null)
		return null;
	const assignment = await transaction.agentRevisionMcpToolAssignment.findUnique({
		where: { agentRevisionId_toolRevisionId: { agentRevisionId: run.agentRevisionId, toolRevisionId } },
		select: {
			agentServiceId: true,
			siloId: true,
			toolRevision: { select: { siloId: true, serverRevision: { select: {
				siloId: true,
				mcpServerId: true,
				transport: true,
				connectionId: true,
				connectionGeneration: true,
				connectionOwnerPrincipalId: true,
				endpointDigest: true,
				server: { select: { credentialRequirement: true } },
				connection: { select: { id: true, siloId: true, mcpServerInstallId: true, mcpServerId: true, ownerPrincipalId: true, agentServiceId: true, generation: true, endpointDigest: true, credentialRequirement: true } },
			} } } },
		},
	});
	if (assignment === null || assignment.agentServiceId !== run.agentServiceId || assignment.siloId !== run.siloId || assignment.toolRevision.siloId !== run.siloId)
		return null;
	const revision = assignment.toolRevision.serverRevision;
	if (revision.siloId !== run.siloId)
		return null;
	const install = await transaction.mcpServerInstall.findUnique({
		where: { mcpServerId_principalId: { mcpServerId: revision.mcpServerId, principalId: subject.principalId } },
		select: { id: true, mcpServerId: true, principalId: true, principal: { select: { siloId: true, provenance: true, displayName: true } } },
	});
	if (install === null || install.mcpServerId !== revision.mcpServerId || install.principalId !== subject.principalId || install.principal.siloId !== run.siloId)
		return null;

	let credentialRequirement: McpCredentialRequirement;
	if (revision.transport === McpExecutionTransport.OciImage)
	{
		if (revision.server.credentialRequirement !== PrismaMcpCredentialRequirement.Credentialless || revision.connectionId !== null || revision.connectionGeneration !== null || revision.connectionOwnerPrincipalId !== null || revision.endpointDigest !== null || revision.connection !== null)
			return null;
		credentialRequirement = McpCredentialRequirement.Credentialless;
	}
	else
	{
		const connection = revision.connection;
		if (revision.transport !== McpExecutionTransport.RemoteHttp || connection === null
			|| revision.connectionId !== connection.id || revision.connectionGeneration !== connection.generation
			|| revision.connectionOwnerPrincipalId !== connection.ownerPrincipalId || revision.endpointDigest !== connection.endpointDigest
			|| connection.siloId !== run.siloId || connection.mcpServerInstallId !== install.id || connection.mcpServerId !== revision.mcpServerId
			|| connection.ownerPrincipalId !== subject.principalId)
			return null;
		credentialRequirement = _CredentialRequirement(connection.credentialRequirement);
	}

	if (subject.membership.kind !== ExecutionSubjectMembershipKinds.Managed)
	{
		if (install.principal.provenance !== PrincipalProvenance.External || install.principal.displayName === null || !_IsDisplayLabel(install.principal.displayName, 200))
			return null;
		if (revision.transport === McpExecutionTransport.RemoteHttp && revision.connection?.agentServiceId !== null)
			return null;
		return { ownerKind: ElicitationConnectionOwnerKinds.Personal, ownerLabel: install.principal.displayName, credentialRequirement };
	}

	const service = await transaction.agentService.findUnique({
		where: { id_siloId: { id: run.agentServiceId, siloId: run.siloId } },
		select: { kind: true, name: true, principalId: true, principal: { select: { provenance: true } }, revisions: { where: { id: run.agentRevisionId }, select: { id: true } } },
	});
	if (service === null || service.kind !== AgentServiceKind.Managed || service.principalId !== subject.principalId || service.principal?.provenance !== PrincipalProvenance.Internal
		|| service.revisions.length !== 1 || (revision.transport === McpExecutionTransport.RemoteHttp && revision.connection?.agentServiceId !== run.agentServiceId) || !_IsDisplayLabel(service.name, 200))
		return null;
	return { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: service.name, credentialRequirement };
}

/**
 * Pause one prepared tool invocation behind a new pending deferred-tool approval.
 *
 * This is the create half of the deferred-tool lifecycle: when the runtime external-action authority
 * returns `deferred` for an approval-gated tool, the composition root calls this to open the pending
 * {@link ApprovalRequest} bound to the awaiting ToolInvocation (`toolInvocationRowId`). It reuses the
 * existing approval table rather than creating a second approval model. The run and invocation must
 * carry the same immutable execution subject, including the exact active computer lease generation.
 * Deferral is idempotent through the `(runId, attempt, actionDigest)` key: a repeated defer returns
 * the existing pending row rather than opening a second approval.
 *
 * The active conversation computer lease is fenced once, by the approval_requests trigger in
 * PostgreSQL: it locks the lease row and compares it with the run's execution subject when the
 * approval row is written. A stale lease therefore surfaces as a thrown Prisma error, which the
 * transaction owner recognises with {@link _IsApprovalRequestFenceRejection}.
 *
 * @param transaction - Prisma transaction already holding the owning run's approval fence.
 * @param command - Awaiting invocation coordinates, tool identity, and expiry.
 * @returns The opened (or replayed) approval id, or `unavailable` when the run, invocation, or approver no longer allow an approval.
 */
export async function __DeferToolRequest(transaction: Prisma.TransactionClient, command: DeferToolRequestCommand): Promise<DeferToolRequestResult>
{
	if (!_IsDisplayLabel(command.toolName, 1_000) || !_IsDisplayLabel(command.externalSystemName, 500))
		return { outcome: DeferToolRequestOutcomes.Unavailable };
	// 1. Bind the approval to the run's immutable execution subject and the invocation admitted for that exact computer lease.
	const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	const invocation = await __FindToolInvocationInTransaction(transaction, command.toolInvocationRowId);
	const subject = _ApprovalExecutionSubject(run, invocation);
	if (run === null || subject === null
		|| run.attempt !== command.attempt || run.conversationId === null
		|| Date.parse(subject.membership.trustedUntil) <= command.now.getTime()
		|| Date.parse(subject.requester.membership.trustedUntil) <= command.now.getTime())
		return { outcome: DeferToolRequestOutcomes.Unavailable };
	const assignedPrincipal = await _resolveAssignedPrincipal(transaction, run.siloId, subject.requester.requesterPrincipalId, run.conversationId);
	if (assignedPrincipal === null)
		return { outcome: DeferToolRequestOutcomes.Unavailable };
	// The lease row is read only for its expiry, which caps the approval deadline; the trigger validates the lease itself when the row is created.
	const activeLease = await transaction.conversationComputerActiveLease.findUnique({ where: { computerId: subject.computerScope.computerId }, select: { expiresAt: true } });
	const expiresAt = new Date(Math.min(command.expiresAt.getTime(), Date.parse(subject.membership.trustedUntil), Date.parse(subject.requester.membership.trustedUntil), activeLease?.expiresAt.getTime() ?? Number.POSITIVE_INFINITY));
	if (expiresAt.getTime() <= command.now.getTime())
		return { outcome: DeferToolRequestOutcomes.Unavailable };
	if (invocation === null || invocation.runId !== command.runId || invocation.attempt !== command.attempt || invocation.toolRevisionId !== command.toolRevisionId || invocation.argumentsDigest !== command.argumentsDigest || invocation.state !== ToolInvocationStates.AwaitingApproval)
		return { outcome: DeferToolRequestOutcomes.Unavailable };
	const runState = _approvalRunState(run.state);
	if (runState === null)
		return { outcome: DeferToolRequestOutcomes.Unavailable };

	// 2. Replay an exact existing defer before changing run state; digest collisions fail closed.
	const existing = await transaction.approvalRequest.findFirst({ where: { runId: command.runId, attempt: command.attempt, actionDigest: command.actionDigest } });
	if (existing !== null)
	{
		const request = existing.elicitationRequestId === null ? null : await transaction.elicitationRequest.findUnique({ where: { id: existing.elicitationRequestId } });
		const isToolApproval = request !== null && request.purpose === ElicitationPurpose.ToolApproval && request.bodyKind === ElicitationBodyKind.Approval;
		if (existing.id !== command.interruptId || existing.principalId !== run.principalId || existing.toolInvocationRowId !== invocation.id
			|| existing.argumentsDigest !== command.argumentsDigest || existing.reviewedToolSchemaDigest !== command.reviewedParametersSchemaDigest
			|| !_MatchesApprovalElicitation(existing, request, run, assignedPrincipal.subjectId, isToolApproval))
			throw new Error("deferred approval action digest collision");
		if (existing.state === ApprovalRequestState.Pending)
			await __ReconcileDeferredToolApprovalGrants(transaction, run.siloId, existing.id, assignedPrincipal.principalId, command.now);
		return { outcome: DeferToolRequestOutcomes.AlreadyDeferred, approvalRequestId: existing.id };
	}
	const executionConnection = await _ExecutionConnection(transaction, run, subject, command.toolRevisionId);
	if (executionConnection === null)
		return { outcome: DeferToolRequestOutcomes.Unavailable };

	// 3. Move the run behind its approval fence before the first row becomes visible, or join its batch.
	const pendingCount = await transaction.approvalRequest.count({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending } });
	const action = __PlanDeferredToolApprovalLifecycle({ runState, event: DeferredToolApprovalLifecycleEvents.Open, pendingCount });
	if (action === DeferredToolApprovalLifecycleActions.PauseAndOpen)
	{
		const paused = await transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForInput } });
		if (paused.count !== 1)
			return { outcome: DeferToolRequestOutcomes.Unavailable };
	}
	else if (action !== DeferredToolApprovalLifecycleActions.OpenInBatch)
		return { outcome: DeferToolRequestOutcomes.Unavailable };

	// 4. Open the participant request and its protected tool evidence in this same transaction.
	try
	{
		const body: ElicitationApprovalBody = {
			kind: ElicitationBodyKinds.Approval,
			prompt: "Allow this agent to invoke the reviewed tool?",
			action: "Invoke tool",
			target: command.toolName,
			dataUse: command.safeProposedArguments === null
				? "Some proposed values are hidden because the tool marks them sensitive. This request can only be denied."
				: "The proposed arguments shown in this request will be sent to the tool.",
			externalSystem: command.externalSystemName,
			consequence: _ApprovalConsequence(command.toolDescription),
			proposedArguments: command.safeProposedArguments,
			executionConnection,
		};
		const purposePayload = { approvalRequestId: command.interruptId };
		await transaction.elicitationRequest.create({ data: {
			id: command.interruptId,
			siloId: run.siloId,
			conversationId: run.conversationId,
			runId: command.runId,
			attempt: command.attempt,
			assignedParticipantId: assignedPrincipal.subjectId,
			requestKey: command.actionDigest,
			purpose: ElicitationPurpose.ToolApproval,
			bodyKind: ElicitationBodyKind.Approval,
			body: body as unknown as Prisma.InputJsonValue,
			bodyDigest: __DigestCanonicalJson(body as unknown as JsonValue),
			purposePayload,
			purposePayloadDigest: __DigestCanonicalJson(purposePayload),
			state: ElicitationRequestState.Requested,
			requiresStepUp: true,
			expiresAt,
			createdAt: command.now,
		} });
		const created = await transaction.approvalRequest.create({
			data: {
				id: command.interruptId,
				elicitationRequestId: command.interruptId,
				runId: command.runId,
				attempt: command.attempt,
				agentRevisionId: run.agentRevisionId,
				agentServiceId: run.agentServiceId,
				siloId: run.siloId,
				agentIdentityId: run.agentIdentityId,
				principalId: run.principalId,
				resourceKind: "tool",
				resourceId: command.toolRevisionId,
				action: "invoke",
				argumentsDigest: command.argumentsDigest,
				actionDigest: command.actionDigest,
				approverPolicyRevision: command.approverPolicyRevision,
				effectivePolicyDigest: command.effectivePolicyDigest,
				state: ApprovalRequestState.Pending,
				expiresAt,
				toolInvocationRowId: command.toolInvocationRowId,
				reviewedToolArguments: command.reviewedArguments as unknown as Prisma.InputJsonValue,
				reviewedToolSchema: command.reviewedParametersSchema as unknown as Prisma.InputJsonValue,
				reviewedToolSchemaDigest: command.reviewedParametersSchemaDigest,
				safeProposedArguments: command.safeProposedArguments === null ? Prisma.JsonNull : command.safeProposedArguments as unknown as Prisma.InputJsonValue,
				responseSchema: command.responseSchema as unknown as Prisma.InputJsonValue,
			},
		});
		await __ReconcileDeferredToolApprovalGrants(transaction, run.siloId, created.id, assignedPrincipal.principalId, command.now);
		return { outcome: DeferToolRequestOutcomes.Deferred, approvalRequestId: created.id };
	}
	catch (error)
	{
		if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
			throw error;
		const raced = await transaction.approvalRequest.findFirst({ where: { runId: command.runId, attempt: command.attempt, actionDigest: command.actionDigest } });
		if (raced === null)
			throw error;
		const request = raced.elicitationRequestId === null ? null : await transaction.elicitationRequest.findUnique({ where: { id: raced.elicitationRequestId } });
		const isToolApproval = request !== null && request.purpose === ElicitationPurpose.ToolApproval && request.bodyKind === ElicitationBodyKind.Approval;
		if (raced.id !== command.interruptId || raced.principalId !== run.principalId || raced.toolInvocationRowId !== invocation.id
			|| raced.argumentsDigest !== command.argumentsDigest || raced.reviewedToolSchemaDigest !== command.reviewedParametersSchemaDigest
			|| !_MatchesApprovalElicitation(raced, request, run, assignedPrincipal.subjectId, isToolApproval))
			throw error;
		if (raced.state === ApprovalRequestState.Pending)
			await __ReconcileDeferredToolApprovalGrants(transaction, run.siloId, raced.id, assignedPrincipal.principalId, command.now);
		return { outcome: DeferToolRequestOutcomes.AlreadyDeferred, approvalRequestId: raced.id };
	}
}
