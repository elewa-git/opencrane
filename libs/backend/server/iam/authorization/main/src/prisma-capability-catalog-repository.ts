import type { Prisma } from "@prisma/client";

import type { CapabilityReference } from "@opencrane/models/authorization";
import type { CapabilityCatalogRepository } from "./capability-catalog.types";

/** Transaction-scoped immutable capability-catalog reader. */
export class PrismaCapabilityCatalogRepository implements CapabilityCatalogRepository
{
	private readonly _transaction: Prisma.TransactionClient;

	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	async findCapability(catalogId: string, revision: number, capabilityId: string): Promise<CapabilityReference | null>
	{
		const row = await this._transaction.capabilityCatalogRevision.findUnique({ where: { catalogId_revision: { catalogId, revision } }, select: { digest: true, capabilities: true } });
		if (!row || !Array.isArray(row.capabilities)) return null;
		const exists = row.capabilities.some(function _Matches(value)
		{
			return typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && value.id === capabilityId;
		});
		if (!exists) return null;
		return { catalog: { catalogId, revision, digest: row.digest as `sha256:${string}` }, capabilityId };
	}
}
