import { AuthorizationScopeKind, GrantSubjectType, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { IdentityEnvelopeInput, PreferenceFactInput, PreferenceFactSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Reads only consented, explicit preference facts from the verified user's exact organization-scoped personal dataset. */
export class PrismaPreferenceFactSource implements PreferenceFactSource
{
	/** Returns no preferences for service evidence, or owner-proven personal facts for a user identity. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>
	{
		// 1. Managed services have no delegated personal owner, so they must not inherit user preference facts.
		if (run.agentKind === "managed") return { outcome: "loaded", value: [] };
		if (command.identityKind !== "user") return { outcome: "denied", reason: "memory_scope_unavailable" };
		if (identity.kind !== "user" || run.delegatedUserId === null || run.delegatedUserId !== command.executionSubjectId || identity.executionSubjectId !== run.delegatedUserId) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 2. Select only the exact organization-and-user dataset proven by the signed identity, never a cross-organization personal dataset.
		const dataset = await transaction.prisma.memoryDataset.findFirst({
			where: { siloId: command.siloId, scopeKind: AuthorizationScopeKind.Personal, subjectType: GrantSubjectType.User, organizationId: identity.organizationId, scopeResourceId: identity.executionSubjectId, state: MemoryDatasetState.Active },
			select: { id: true },
		});
		if (dataset === null) return { outcome: "loaded", value: [] };

		// 3. Keep only retained, consented facts whose structured provenance identifies this exact user as the preference source.
		const facts = await transaction.prisma.memoryFactCatalog.findMany({
			where: { datasetId: dataset.id, state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } },
			select: { id: true, provenance: true },
		});
		return { outcome: "loaded", value: facts.filter(function _IsOwnerPreference(fact): boolean { return _IsExplicitOwnerPreference(fact.provenance, identity.executionSubjectId); }).map(function _PreferenceFact(fact): PreferenceFactInput { return { id: fact.id }; }) };
	}
}

/** Returns whether persisted provenance proves the exact verified user explicitly supplied this fact. */
function _IsExplicitOwnerPreference(provenance: unknown, userId: string): boolean
{
	if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) return false;
	const record = provenance as Readonly<Record<string, unknown>>;
	return record["sourceKind"] === "explicit-user-fact" && record["sourceUserId"] === userId;
}
