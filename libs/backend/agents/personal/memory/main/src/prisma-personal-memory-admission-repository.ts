import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState, type Prisma } from "@prisma/client";

import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";

import type { PersonalMemoryAdmissionRepository, PersonalMemoryDataset, ResolvePersonalMemoryDatasetCommand } from "./personal-memory-dataset.types.js";

/** Prisma authority that selects verified personal datasets and preference facts inside run admission. */
export class PrismaPersonalMemoryAdmissionRepository implements PersonalMemoryAdmissionRepository
{
	/** Admission transaction that freezes dataset and fact selection with the run snapshot. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind personal-memory reads to the caller's existing admission transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Returns the one active personal dataset matching the exact signed identity tuple. */
	async findActivePersonalDataset(command: ResolvePersonalMemoryDatasetCommand): Promise<PersonalMemoryDataset | null>
	{
		const dataset = await this.transaction.memoryDataset.findFirst({
			where: {
				siloId: command.siloId,
				organizationId: command.organizationId,
				scopeKind: AuthorizationScopeKind.Personal,
				scopeResourceId: command.subjectId,
				state: MemoryDatasetState.Active,
			},
			select: { id: true, cogneeDatasetId: true },
		});
		return dataset === null ? null : { datasetId: dataset.id, cogneeDatasetId: dataset.cogneeDatasetId };
	}

	/** Returns only active consented facts whose structured provenance identifies the verified owner. */
	async findActivePreferenceFactIds(command: ResolvePersonalMemoryDatasetCommand): Promise<readonly string[]>
	{
		// 1. Re-resolve the exact active personal dataset under the admission transaction rather than trusting a previous lookup.
		const dataset = await this.findActivePersonalDataset(command);
		if (dataset === null) return [];

		// 2. Read only retained and consented metadata; durable fact content remains exclusively behind the Cognee gateway.
		const facts = await this.transaction.memoryFactCatalog.findMany({
			where: { datasetId: dataset.datasetId, state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } },
			select: { id: true, provenance: true },
		});

		// 3. Project only preferences explicitly supplied by this verified subject, never message-derived or cross-user facts.
		return facts.filter(function _IsOwnerPreference(fact): boolean { return _IsExplicitOwnerPreference(fact.provenance, command.subjectId); }).map(function _PreferenceFactId(fact): string { return fact.id; });
	}
}

/** Returns whether persisted provenance proves the exact verified user explicitly supplied this fact. */
function _IsExplicitOwnerPreference(provenance: unknown, userId: string): boolean
{
	if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) return false;
	const record = provenance as Readonly<Record<string, unknown>>;
	return record["sourceKind"] === MemoryFactProvenanceSourceKinds.ExplicitUserFact && record["sourceUserId"] === userId;
}
