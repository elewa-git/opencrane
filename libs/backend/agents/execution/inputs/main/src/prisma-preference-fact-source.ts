import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { IdentityEnvelopeInput, PreferenceFactInput, PreferenceFactSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Transaction-fenced source for explicit, consented personal facts used as run preferences. */
export class PrismaPreferenceFactSource implements PreferenceFactSource
{
	/** Load active consented facts from the delegated user's own personal dataset, or none for managed runs. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>
	{
		if (run.agentKind === "managed") return { outcome: "loaded", value: [] };
		if (run.delegatedUserId === null || run.delegatedUserId !== command.executionSubjectId) return { outcome: "denied", reason: "memory_scope_unavailable" };

		// 1. Find only the user's Personal dataset; organization, department, and project facts cannot personalize this run.
		const dataset = await transaction.prisma.memoryDataset.findFirst({
			where: { siloId: command.siloId, scopeKind: AuthorizationScopeKind.Personal, organizationId: identity.organizationId, scopeResourceId: run.delegatedUserId, state: MemoryDatasetState.Active },
			select: { id: true },
		});
		if (dataset === null) return { outcome: "loaded", value: [] };

		// 2. Accept only retained, consented facts whose provenance explicitly identifies this user.
		const facts = await transaction.prisma.memoryFactCatalog.findMany({
			where: { datasetId: dataset.id, state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } },
			select: { id: true, provenance: true },
		});
		return { outcome: "loaded", value: facts.filter(function _isOwnerPreference(fact) { return _IsExplicitOwnerPreference(fact.provenance, run.delegatedUserId!); }).map(function _toPreference(fact) { return { id: fact.id }; }) };
	}
}

/** Return whether structured provenance proves the fact is an explicit preference of this exact user. */
function _IsExplicitOwnerPreference(provenance: unknown, userId: string): boolean
{
	if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) return false;
	const record = provenance as Readonly<Record<string, unknown>>;
	return record["sourceKind"] === "explicit-user-fact" && record["sourceUserId"] === userId;
}
