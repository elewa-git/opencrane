import { __DigestHumanMembershipEvidence, __HumanMembershipRevision } from "@opencrane/backend/server/iam/membership";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ApprovedPersonaInput, MemoryScopeInput, ProductResourceAuthorizationSource, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicyInput } from "./session-assembly.types";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Rechecks current Use grants for the complete exact resource set selected during admission. */
export class TransactionBoundProductResourceAuthorizationSource implements ProductResourceAuthorizationSource
{
	/** @inheritdoc */
	async load(command: SessionAssemblyCommand, executionSubject: ExecutionSubject, persona: ApprovedPersonaInput, memory: MemoryScopeInput, tools: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>
	{
		if (transaction.authorization === undefined)
		{
			return { outcome: "denied", reason: "product_authorization_unavailable" };
		}
		const principalId = executionSubject.principalId;
		const resources = _Resources(persona, memory, tools);
		const argumentsDigest = ___DigestCanonicalJson({ runId: command.runId, attempt: 1, siloId: command.siloId, agentServiceId: command.agentServiceId, agentRevisionId: executionSubject.runScope.agentRevisionId, conversationId: command.conversationId, requestIdempotencyKey: command.requestIdempotencyKey, membershipDigest: ___DigestCanonicalJson(executionSubject.membership as unknown as JsonValue), requesterMembershipDigest: __DigestHumanMembershipEvidence(executionSubject.requester.membership) } as JsonValue);
		const conversation = await this.verifyExisting(command, executionSubject, transaction);
		if (conversation.outcome === "denied")
			return conversation;
		const membershipRevision = executionSubject.membership.kind === ExecutionSubjectMembershipKinds.Fleet ? executionSubject.membership.revision : undefined;
		// Admission records the execution Principal; a runtime Pod has not requested these resources.
		const actorKind = executionSubject.membership.kind === ExecutionSubjectMembershipKinds.Managed ? "agent-service" : "user";
		const admissions = await transaction.authorization.admitPrincipalBatch(resources.map(resource => ({ siloId: command.siloId, principalId, actorKind, actorId: principalId, action: ProductAuthorizationActions.Use, resource, argumentsDigest, membershipRevision, nowEpochMs: transaction.admittedAtEpochMs })));
		return admissions.length === resources.length ? { outcome: "loaded", value: null } : { outcome: "denied", reason: "product_authorization_unavailable" };
	}

	/** Re-admits current requester access without replaying snapshot resource admissions. */
	async verifyExisting(command: SessionAssemblyCommand, executionSubject: ExecutionSubject, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>
	{
		if (command.conversationId === null)
			return { outcome: "loaded", value: null };
		if (transaction.authorization === undefined)
			return { outcome: "denied", reason: "product_authorization_unavailable" };
		const argumentsDigest = ___DigestCanonicalJson({ runId: command.runId, attempt: 1, siloId: command.siloId, agentServiceId: command.agentServiceId, agentRevisionId: executionSubject.runScope.agentRevisionId, conversationId: command.conversationId, requestIdempotencyKey: command.requestIdempotencyKey, membershipDigest: ___DigestCanonicalJson(executionSubject.membership as unknown as JsonValue), requesterMembershipDigest: __DigestHumanMembershipEvidence(executionSubject.requester.membership) } as JsonValue);
		const requester = executionSubject.requester;
		const conversation = await transaction.authorization.admitPrincipal({ siloId: command.siloId, principalId: requester.requesterPrincipalId, actorKind: "user", actorId: requester.requesterPrincipalId, action: ProductAuthorizationActions.Use, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: command.conversationId }, argumentsDigest, membershipRevision: __HumanMembershipRevision(requester.membership), nowEpochMs: transaction.admittedAtEpochMs });
		return conversation.outcome === AuthorizationDecisionOutcomes.Allow && conversation.evidence !== null ? { outcome: "loaded", value: null } : { outcome: "denied", reason: "product_authorization_unavailable" };
	}
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
