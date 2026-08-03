import { AuthorizationScopeKind, GrantSubjectType, MemoryDatasetState } from "@prisma/client";
import type { ManagedRunInputScopeAttachment } from "@opencrane/contracts";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { ManagedMemoryScopeDataset, ManagedMemoryScopeSelector } from "./managed-memory-scope-source.types.js";
import type { IdentityEnvelopeInput, MemoryScopeInput, MemoryScopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Resolves a managed run's already-authorised scope attachments to active catalogued Cognee datasets. */
export class ManagedMemoryScopeSource implements MemoryScopeSource
{
	/** Freezes every active dataset matching the managed identity's exact effective attachments. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>
	{
		// 1. Only a managed identity with pre-verified effective attachments can enter this path.
		// `managed` is the persisted run-agent-kind contract; it has no shared enum yet.
		if (run.agentKind !== "managed" || identity.kind !== "service" || identity.agentServiceId !== run.agentServiceId) return { outcome: "denied", reason: "memory_scope_unavailable" };
		const selectors = _CanonicalSelectors(identity.effectiveScopeAttachments);
		if (selectors === null) return { outcome: "denied", reason: "memory_scope_unavailable" };
		if (selectors.length === 0) return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" }, memoryFacts: [] } };

		// 2. Resolve only active catalogued datasets in the same sealed silo and organisation.
		const datasets = await transaction.prisma.memoryDataset.findMany({
			where: {
				siloId: command.siloId,
				organizationId: identity.organizationId,
				state: MemoryDatasetState.Active,
				OR: selectors.map(function _Where(selector) { return { scopeKind: selector.scopeKind, subjectType: selector.persistedSubjectType, scopeResourceId: _ScopeResourceId(selector) }; }),
			},
			select: { id: true, cogneeDatasetId: true, scopeKind: true, subjectType: true, scopeResourceId: true },
		});
		const resolved = _ResolveDatasets(selectors, datasets);
		if (resolved === null) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 3. Seal the complete set; the runtime can submit a query only and cannot add or replace scopes.
		return {
			outcome: "loaded",
			value: {
				memoryQueryPolicy: {
					scope: "attached",
					datasets: resolved.map(function _PolicyDataset(dataset)
					{
						return { datasetId: dataset.datasetId, cogneeDatasetId: dataset.cogneeDatasetId, scope: dataset.scope, subjectType: dataset.subjectType, subjectId: dataset.subjectId };
					}),
				},
				memoryFacts: [],
			},
		};
	}
}

/** Maps only supported effective attachments into distinct database selectors. */
function _CanonicalSelectors(attachments: readonly ManagedRunInputScopeAttachment[]): readonly ManagedMemoryScopeSelector[] | null
{
	const selectors: ManagedMemoryScopeSelector[] = [];
	for (const attachment of attachments)
	{
		const scopeKind = _ScopeKind(attachment.scope);
		const subjectType = _SubjectType(attachment.subjectType);
		if (scopeKind === null || subjectType === null || attachment.subjectId.trim().length === 0) return null;
		if (scopeKind === AuthorizationScopeKind.Organization && attachment.subjectId !== "default") return null;
		selectors.push({ scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId, scopeKind, persistedSubjectType: subjectType });
	}
	selectors.sort(_CompareSelector);
	for (let index = 1; index < selectors.length; index += 1)
	{
		if (_CompareSelector(selectors[index - 1]!, selectors[index]!) === 0) return null;
	}
	return selectors;
}

/** Returns the active datasets only when every frozen attachment has exactly one matching catalog row. */
function _ResolveDatasets(selectors: readonly ManagedMemoryScopeSelector[], datasets: readonly { readonly id: string; readonly cogneeDatasetId: string; readonly scopeKind: AuthorizationScopeKind; readonly subjectType: GrantSubjectType; readonly scopeResourceId: string | null }[]): readonly ManagedMemoryScopeDataset[] | null
{
	const byCoordinate = new Map<string, { readonly id: string; readonly cogneeDatasetId: string }>();
	for (const dataset of datasets)
	{
		const scope = _ScopeName(dataset.scopeKind);
		const subjectType = _SubjectTypeName(dataset.subjectType);
		const subjectId = scope === null ? null : _DatasetSubjectId(scope, dataset.scopeResourceId);
		if (scope === null || subjectType === null || subjectId === null || !dataset.id.trim() || !dataset.cogneeDatasetId.trim()) return null;
		const key = _SelectorKey({ scope, subjectType, subjectId });
		if (byCoordinate.has(key)) return null;
		byCoordinate.set(key, dataset);
	}
	const resolved: ManagedMemoryScopeDataset[] = [];
	for (const selector of selectors)
	{
		const dataset = byCoordinate.get(_SelectorKey(selector));
		if (dataset === undefined) return null;
		resolved.push({ datasetId: dataset.id, cogneeDatasetId: dataset.cogneeDatasetId, scope: selector.scope, subjectType: selector.subjectType, subjectId: selector.subjectId });
	}
	return resolved;
}

/** Maps the domain attachment scope into the memory catalogue's independent scope enum. */
function _ScopeKind(scope: string): AuthorizationScopeKind | null
{
	switch (scope)
	{
		case "org": return AuthorizationScopeKind.Organization;
		case "department": return AuthorizationScopeKind.Department;
		case "team": return AuthorizationScopeKind.Team;
		case "project": return AuthorizationScopeKind.Project;
		case "personal": return AuthorizationScopeKind.Personal;
		default: return null;
	}
}

/** Maps the domain target type into the shared persisted subject-type enum. */
function _SubjectType(subjectType: string): GrantSubjectType | null
{
	switch (subjectType)
	{
		case "group": return GrantSubjectType.Group;
		case "user": return GrantSubjectType.User;
		default: return null;
	}
}

/** Maps a persisted memory scope back into the canonical snapshot spelling. */
function _ScopeName(scope: AuthorizationScopeKind): string | null
{
	switch (scope)
	{
		case AuthorizationScopeKind.Organization: return "org";
		case AuthorizationScopeKind.Department: return "department";
		case AuthorizationScopeKind.Team: return "team";
		case AuthorizationScopeKind.Project: return "project";
		case AuthorizationScopeKind.Personal: return "personal";
		default: return null;
	}
}

/** Maps the persisted target type back into the canonical snapshot spelling. */
function _SubjectTypeName(subjectType: GrantSubjectType): string | null
{
	switch (subjectType)
	{
		case GrantSubjectType.Group: return "group";
		case GrantSubjectType.User: return "user";
		default: return null;
	}
}

/** Maps the organization singleton to its stable attachment subject while preserving null storage. */
function _DatasetSubjectId(scope: string, resourceId: string | null): string | null
{
	if (scope === "org") return resourceId === null ? "default" : null;
	return resourceId === null || !resourceId.trim() ? null : resourceId;
}

/** Maps an attached organization singleton back to the catalogue's null resource coordinate. */
function _ScopeResourceId(selector: ManagedMemoryScopeSelector): string | null
{
	return selector.scope === "org" ? null : selector.subjectId;
}

/** Produces a collision-free key for one exact scope target. */
function _SelectorKey(selector: Pick<ManagedMemoryScopeSelector, "scope" | "subjectType" | "subjectId">): string
{
	return `${selector.scope}\u0000${selector.subjectType}\u0000${selector.subjectId}`;
}

/** Sorts scope coordinates deterministically before snapshot persistence. */
function _CompareSelector(left: ManagedMemoryScopeSelector, right: ManagedMemoryScopeSelector): number
{
	return _SelectorKey(left).localeCompare(_SelectorKey(right), "en");
}
