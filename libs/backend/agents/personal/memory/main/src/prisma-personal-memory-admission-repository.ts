import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState, type Prisma } from "@prisma/client";

import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";

import type { PersonalMemoryAdmissionRepository, PersonalMemoryDataset, ResolvePersonalMemoryDatasetCommand } from "./personal-memory-dataset.types";

/**
 * Reads a user's personal dataset and preference facts inside the run-admission transaction.
 *
 * Takes a transaction client rather than a `PrismaClient` so both reads see the same frozen
 * state as the rest of the run's input snapshot. It never writes.
 *
 * Constructed by: `_CreatePersonalMemory` in
 * libs/backend/agents/execution/inputs/main/src/prisma-session-assembly-authorities.ts.
 *
 * @implements PersonalMemoryAdmissionRepository
 */
export class PrismaPersonalMemoryAdmissionRepository implements PersonalMemoryAdmissionRepository
{
	/** The admission transaction, so these reads are frozen together with the run snapshot. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind personal-memory reads to the caller's existing admission transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * @param command - The three verified identity fields; every one is used in the query.
	 * @returns The Active dataset scoped Personal to this subject, or null when none matches.
	 */
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

	/**
	 * Looks the dataset up again in this transaction, then filters its facts down to the user's own.
	 *
	 * The dataset is re-read rather than passed in, so a stale id from an earlier lookup can never
	 * select facts from a dataset that is no longer this user's.
	 *
	 * @param command - The three verified identity fields.
	 * @returns Ids of Active facts with Explicit or Confirmed consent whose provenance names this
	 * subject as having stated them. Empty when the user has no Active dataset.
	 */
	async findActivePreferenceFactIds(command: ResolvePersonalMemoryDatasetCommand): Promise<readonly string[]>
	{
		// 1. Look the dataset up again inside this transaction instead of trusting an earlier lookup.
		const dataset = await this.findActivePersonalDataset(command);
		if (dataset === null) return [];

		// 2. Read only active, consented metadata; the fact content stays behind the Cognee gateway.
		const facts = await this.transaction.memoryFactCatalog.findMany({
			where: { datasetId: dataset.datasetId, state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } },
			select: { id: true, provenance: true },
		});

		// 3. Keep only facts this user stated themselves, never facts derived from messages or belonging to another user.
		return facts.filter(function _IsOwnerPreference(fact): boolean { return _IsExplicitOwnerPreference(fact.provenance, command.subjectId); }).map(function _PreferenceFactId(fact): string { return fact.id; });
	}
}

/** Returns whether the stored provenance says this user stated the fact themselves. */
function _IsExplicitOwnerPreference(provenance: unknown, userId: string): boolean
{
	if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) return false;
	const record = provenance as Readonly<Record<string, unknown>>;
	return record["sourceKind"] === MemoryFactProvenanceSourceKinds.ExplicitUserFact && record["sourceUserId"] === userId;
}
