import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import type { ExecutionSubject } from "@opencrane/models/agents";
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
		const argumentsDigest = ___DigestCanonicalJson({ runId: command.runId, agentServiceId: command.agentServiceId, conversationId: command.conversationId } as JsonValue);
		const admissions = await transaction.authorization.admitPrincipalBatch(resources.map(resource => ({ siloId: command.siloId, principalId, actorKind: "workload", actorId: executionSubject.agentIdentityId, action: ProductAuthorizationActions.Use, resource, argumentsDigest, membershipRevision: executionSubject.membership.revision, nowEpochMs: transaction.admittedAtEpochMs })));
		return admissions.length === resources.length ? { outcome: "loaded", value: null } : { outcome: "denied", reason: "product_authorization_unavailable" };
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
