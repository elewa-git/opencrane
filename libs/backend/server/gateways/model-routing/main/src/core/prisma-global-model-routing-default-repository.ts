import type { Prisma } from "@prisma/client";

import type { GlobalModelRoutingDefaultRepository } from "./global-model-routing-default-repository.types";

/**
 * Publishes the first Global routing default while preserving any operator-configured row.
 *
 * The nullable tenant column prevents a portable compound upsert. This adapter owns the
 * read-create race and accepts a `P2002` loser only when the winning Global row is visible.
 *
 * Called by: `_ProvisionByokKey`, which supplies it to `_EnsureProviderModels`.
 * @implements {GlobalModelRoutingDefaultRepository}
 */
export class PrismaGlobalModelRoutingDefaultRepository implements GlobalModelRoutingDefaultRepository
{
	/** Transaction-capable Prisma client supplied by the provider-custody composition. */
	private readonly prisma: Prisma.TransactionClient;

	/** Binds routing-default publication to the caller's Prisma client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Creates only the first Global default and converges a concurrent first create. */
	async ensureFirst(publicModelName: string): Promise<void>
	{
		const where = {
			scope: "Global" as const,
			clusterTenant: null,
		};

		if (await this.prisma.modelRoutingDefault.findFirst({ where }))
		{
			return;
		}
		try
		{
			await this.prisma.modelRoutingDefault.create({
				data: {
					...where,
					defaultModel: publicModelName,
				},
			});
		}
		catch (error)
		{
			if ((error as { code?: unknown }).code !== "P2002")
			{
				throw error;
			}
			if (!await this.prisma.modelRoutingDefault.findFirst({ where }))
			{
				throw error;
			}
		}
	}
}
