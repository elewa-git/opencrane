import type { Prisma, ProviderCredential } from "@prisma/client";

import type { GlobalProviderCredentialProjection, GlobalProviderCredentialProjectionRepository, UpsertGlobalProviderCredentialCommand } from "./provider-credential-projection-repository.types";

/** Maps a Prisma row to the Prisma-free Global provider projection contract. */
function _ToGlobalProjection(row: ProviderCredential): GlobalProviderCredentialProjection
{
	if (row.scope !== "Global" || row.clusterTenant !== null)
	{
		throw new Error("provider credential repository returned a non-Global projection");
	}
	return {
		id: row.id,
		litellmCredentialName: row.litellmCredentialName,
		updatedAt: row.updatedAt,
	};
}

/**
 * Persists Global provider-credential projections after Kubernetes and LiteLLM custody changes.
 *
 * The nullable tenant column prevents a portable compound upsert. This adapter therefore owns the
 * read-create race and converges a `P2002` loser on the row committed by the concurrent writer.
 * Raw provider keys never cross this repository boundary.
 *
 * Called by: `_ProvisionByokKey` and `_DeprovisionByokKey` in `provision-byok-key.ts`.
 * @implements {GlobalProviderCredentialProjectionRepository}
 */
export class PrismaGlobalProviderCredentialProjectionRepository implements GlobalProviderCredentialProjectionRepository
{
	/** Transaction-capable Prisma client supplied by the provider-custody composition. */
	private readonly prisma: Prisma.TransactionClient;

	/** Binds provider projection writes to the caller's Prisma client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Creates or updates the provider's Global row and converges a concurrent first create. */
	async upsertGlobal(command: UpsertGlobalProviderCredentialCommand)
	{
		const where = {
			scope: "Global" as const,
			clusterTenant: null,
			provider: command.provider,
		};
		const existing = await this.prisma.providerCredential.findFirst({ where });

		if (existing)
		{
			return _ToGlobalProjection(await this._Update(existing.id, command));
		}
		try
		{
			const created = await this.prisma.providerCredential.create({
				data: {
					...where,
					secretRef: command.secretRef,
					litellmCredentialName: command.litellmCredentialName,
				},
			});
			return _ToGlobalProjection(created);
		}
		catch (error)
		{
			if ((error as { code?: unknown }).code !== "P2002")
			{
				throw error;
			}
			const raced = await this.prisma.providerCredential.findFirst({ where });

			if (!raced)
			{
				throw error;
			}
			return _ToGlobalProjection(await this._Update(raced.id, command));
		}
	}

	/** Deletes only the provider's Global projection. */
	async deleteGlobal(provider: string): Promise<void>
	{
		await this.prisma.providerCredential.deleteMany({
			where: {
				scope: "Global",
				clusterTenant: null,
				provider,
			},
		});
	}

	/** Applies the mutable custody references to one identified projection. */
	private _Update(id: string, command: UpsertGlobalProviderCredentialCommand)
	{
		return this.prisma.providerCredential.update({
			where: { id },
			data: {
				secretRef: command.secretRef,
				litellmCredentialName: command.litellmCredentialName,
			},
		});
	}
}
