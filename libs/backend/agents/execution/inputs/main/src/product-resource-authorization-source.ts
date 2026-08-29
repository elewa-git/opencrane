import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import type { ApprovedPersonaInput, IdentityEnvelopeInput, MemoryScopeInput, ProductResourceAuthorizationSource, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicyInput } from "./session-assembly.types";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Rechecks current Use grants for the complete exact resource set selected during admission. */
export class TransactionBoundProductResourceAuthorizationSource implements ProductResourceAuthorizationSource
{
	/** @inheritdoc */
	async load(command: SessionAssemblyCommand, identity: IdentityEnvelopeInput, persona: ApprovedPersonaInput, memory: MemoryScopeInput, tools: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>
	{
		if (transaction.authorization === undefined)
			return { outcome: "denied", reason: "product_authorization_unavailable" };
		const principalId = identity.kind === RunInputSnapshotIdentityKinds.User ? identity.principalId : identity.executionSubjectId;
		const resources = _Resources(persona, memory, tools);
		const entitled = await transaction.authorization.listPrincipalEntitled({ siloId: command.siloId, principalId, action: ProductAuthorizationActions.Use, resources, nowEpochMs: transaction.admittedAtEpochMs });
		return _ContainsEveryResource(entitled, resources) ? { outcome: "loaded", value: null } : { outcome: "denied", reason: "product_authorization_unavailable" };
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

/** Compares typed coordinates without depending on authority return order. */
function _ContainsEveryResource(actual: readonly ProductAuthorizationResourceLocator[], expected: readonly ProductAuthorizationResourceLocator[]): boolean
{
	const coordinates = new Set(actual.map(resource => `${resource.kind}:${resource.id}`));
	return expected.every(resource => coordinates.has(`${resource.kind}:${resource.id}`));
}
