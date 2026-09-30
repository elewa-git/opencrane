import type { RunAdmissionPayer, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { __DigestHumanMembershipEvidence, __HumanMembershipRevision } from "@opencrane/backend/server/iam/membership";
import { AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { AgentRunTriggers, ExecutionSubjectMembershipKinds, __RoutineFiringAuditActor, type ExecutionSubject } from "@opencrane/models/agents";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { SessionAssemblyLoadOutcomes, type ApprovedPersonaInput, type ConversationContextRepositoryFactory, type MemoryScopeInput, type ProductResourceAuthorizationSource, type SessionAssemblyCommand, type SessionAssemblyLoad, type ToolPolicyInput } from "../assembly/session-assembly.types";

/** Rechecks current Use grants for the complete exact resource set selected during admission. */
export class TransactionBoundProductResourceAuthorizationSource implements ProductResourceAuthorizationSource
{
	/** Builds the boundary-approved conversation reader over the current admission transaction. */
	private readonly createConversation: ConversationContextRepositoryFactory;

	/** Keeps payer reads inside the same repository and transaction as conversation admission. */
	constructor(createConversation: ConversationContextRepositoryFactory)
	{
		this.createConversation = createConversation;
	}

	/** @inheritdoc */
	async load(command: SessionAssemblyCommand, executionSubject: ExecutionSubject, persona: ApprovedPersonaInput, memory: MemoryScopeInput, tools: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<RunAdmissionPayer | null>>
	{
		if (transaction.authorization === undefined)
		{
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		}
		const principalId = executionSubject.principalId;
		const resources = _Resources(persona, memory, tools);
		const argumentsDigest = _ArgumentsDigest(command, executionSubject);
		const conversation = await this._AdmitConversationAndPayer(command, executionSubject, undefined, transaction, argumentsDigest);
		if (conversation.outcome === SessionAssemblyLoadOutcomes.Denied)
			return conversation;
		const membershipRevision = executionSubject.membership.kind === ExecutionSubjectMembershipKinds.Fleet ? executionSubject.membership.revision : undefined;
		// Admission records the execution Principal; a runtime Pod has not requested these resources.
		const actorKind = executionSubject.membership.kind === ExecutionSubjectMembershipKinds.Managed ? "agent-service" : "user";
		const admissions = await transaction.authorization.admitPrincipalBatch(resources.map(resource => ({ siloId: command.siloId, principalId, actorKind, actorId: principalId, action: ProductAuthorizationActions.Use, resource, argumentsDigest, membershipRevision, nowEpochMs: transaction.admittedAtEpochMs })));
		return admissions.length === resources.length ? conversation : { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
	}

	/**
	 * Re-admits current requester Conversation Use without replaying snapshot resource admissions.
	 * A routine trigger selects the audit actor but never replaces that requester Principal.
	 */
	async verifyExisting(command: SessionAssemblyCommand, executionSubject: ExecutionSubject, expectedPayer: RunAdmissionPayer | null, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<RunAdmissionPayer | null>>
	{
		if (transaction.authorization === undefined)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		return this._AdmitConversationAndPayer(command, executionSubject, expectedPayer, transaction, _ArgumentsDigest(command, executionSubject));
	}

	/** Re-admit current conversation and payer use while returning the original saved payer tuple. */
	private async _AdmitConversationAndPayer(command: SessionAssemblyCommand, executionSubject: ExecutionSubject, expectedPayer: RunAdmissionPayer | null | undefined, transaction: RunAdmissionTransaction, argumentsDigest: `sha256:${string}`): Promise<SessionAssemblyLoad<RunAdmissionPayer | null>>
	{
		if (command.conversationId === null)
		{
			return executionSubject.membership.kind !== ExecutionSubjectMembershipKinds.Managed && (expectedPayer === undefined || expectedPayer === null)
				? { outcome: SessionAssemblyLoadOutcomes.Loaded, value: null }
				: { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		}
		if (transaction.authorization === undefined)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		const payer = await this.createConversation(transaction).payer(command);
		if (payer === undefined || !_PayerMatchesExecution(payer, expectedPayer, executionSubject))
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		const requester = executionSubject.requester;
		const actor = command.trigger === AgentRunTriggers.Interactive ? { actorKind: "user" as const, actorId: requester.requesterPrincipalId } : __RoutineFiringAuditActor(command.trigger, requester.requesterPrincipalId);
		const conversation = await transaction.authorization.admitPrincipal({ siloId: command.siloId, principalId: requester.requesterPrincipalId, ...actor, action: ProductAuthorizationActions.Use, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: command.conversationId }, argumentsDigest, membershipRevision: __HumanMembershipRevision(requester.membership), nowEpochMs: transaction.admittedAtEpochMs });
		if (conversation.outcome !== AuthorizationDecisionOutcomes.Allow || conversation.evidence === null)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		if (payer === null)
			return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: null };
		const budget = await transaction.authorization.admit({ siloId: command.siloId, principalId: requester.requesterPrincipalId, ...actor, boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: payer.payingGroupId }, resource: { kind: ProductAuthorizationResourceKinds.Budget, id: `group:${payer.payingGroupId}` }, action: ProductAuthorizationActions.Use, argumentsDigest, membershipRevision: __HumanMembershipRevision(requester.membership), nowEpochMs: transaction.admittedAtEpochMs });
		return budget.outcome === AuthorizationDecisionOutcomes.Allow && budget.evidence !== null
			? { outcome: SessionAssemblyLoadOutcomes.Loaded, value: payer }
			: { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
	}
}

/** Build one action digest shared by conversation, payer and selected-resource admissions. */
function _ArgumentsDigest(command: SessionAssemblyCommand, executionSubject: ExecutionSubject): `sha256:${string}`
{
	return ___DigestCanonicalJson({ runId: command.runId, attempt: 1, siloId: command.siloId, agentServiceId: command.agentServiceId, agentRevisionId: executionSubject.runScope.agentRevisionId, conversationId: command.conversationId, requestIdempotencyKey: command.requestIdempotencyKey, membershipDigest: ___DigestCanonicalJson(executionSubject.membership as unknown as JsonValue), requesterMembershipDigest: __DigestHumanMembershipEvidence(executionSubject.requester.membership) } as JsonValue);
}

/** Require managed execution to use the saved payer exactly and personal execution to keep it null. */
function _PayerMatchesExecution(saved: RunAdmissionPayer | null, expected: RunAdmissionPayer | null | undefined, executionSubject: ExecutionSubject): boolean
{
	if (executionSubject.membership.kind !== ExecutionSubjectMembershipKinds.Managed)
		return saved === null && (expected === undefined || expected === null);
	if (saved === null || expected === null)
		return false;
	return expected === undefined || saved.payingGroupId === expected.payingGroupId
		&& saved.authorization.decisionDigest === expected.authorization.decisionDigest
		&& saved.authorization.policyRevisionHash === expected.authorization.policyRevisionHash
		&& saved.authorization.effectiveAuthorizationDigest === expected.authorization.effectiveAuthorizationDigest;
}

/** Builds one de-duplicated exact resource set from transaction-validated inputs. */
function _Resources(persona: ApprovedPersonaInput, memory: MemoryScopeInput, tools: ToolPolicyInput): readonly ProductAuthorizationResourceLocator[]
{
	const resources: ProductAuthorizationResourceLocator[] = [
		{ kind: ProductAuthorizationResourceKinds.ModelDefinition, id: tools.modelDefinitionId },
		...tools.mcpTools.map(tool => ({ kind: ProductAuthorizationResourceKinds.McpToolRevision, id: tool.toolRevisionId }) as const),
		...tools.skillRevisionIds.map(id => ({ kind: ProductAuthorizationResourceKinds.SkillRevision, id }) as const),
		...tools.artifactRevisionIds.map(id => ({ kind: ProductAuthorizationResourceKinds.ArtifactRevision, id }) as const),
	];
	if (persona.personaId !== null)
		resources.push({ kind: ProductAuthorizationResourceKinds.Persona, id: persona.personaId });
	if (memory.datasetId !== null)
	{
		resources.push({ kind: ProductAuthorizationResourceKinds.Dataset, id: memory.datasetId });
		resources.push({ kind: ProductAuthorizationResourceKinds.MemoryScope, id: memory.datasetId });
	}
	const unique = new Map(resources.map(resource => [`${resource.kind}:${resource.id}`, resource]));
	return [...unique.values()];
}
