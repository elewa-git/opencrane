import { ModelRoutingScope, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { DefaultModelDefinitionResolutionStatuses } from "../core/default-model-definition-resolver.types";
import { PrismaDefaultModelDefinitionResolverRepository } from "../core/prisma-default-model-definition-resolver";

/** Creates a transaction-shaped reader for routing-default and definition resolution. */
function _Transaction()
{
	return {
		modelRoutingDefault: { findMany: vi.fn() },
		modelDefinition: { findMany: vi.fn() },
	};
}

/** Constructs the resolver without widening production code to a test-only client shape. */
function _Resolver(transaction: ReturnType<typeof _Transaction>): PrismaDefaultModelDefinitionResolverRepository
{
	return new PrismaDefaultModelDefinitionResolverRepository(transaction as unknown as Prisma.TransactionClient);
}

describe("Prisma default-model definition resolver", function _Suite()
{
	it("prefers the configured tenant default and its tenant definition", async function _TenantWins()
	{
		const transaction = _Transaction();
		transaction.modelRoutingDefault.findMany.mockResolvedValue([
			{ scope: ModelRoutingScope.Global, defaultModel: "global/model" },
			{ scope: ModelRoutingScope.ClusterTenant, defaultModel: "tenant/model" },
		]);
		transaction.modelDefinition.findMany.mockResolvedValue([
			{ id: "global-same-name", scope: ModelRoutingScope.Global },
			{ id: "tenant-definition", scope: ModelRoutingScope.ClusterTenant },
		]);

		await expect(_Resolver(transaction).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Resolved, modelDefinitionId: "tenant-definition" });
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ publicModelName: "tenant/model" }) }));
	});

	it("falls back to the configured global default", async function _GlobalFallback()
	{
		const transaction = _Transaction();
		transaction.modelRoutingDefault.findMany.mockResolvedValue([{ scope: ModelRoutingScope.Global, defaultModel: "global/model" }]);
		transaction.modelDefinition.findMany.mockResolvedValue([{ id: "global-definition", scope: ModelRoutingScope.Global }]);

		await expect(_Resolver(transaction).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Resolved, modelDefinitionId: "global-definition" });
	});

	it("does not let an empty tenant default shadow the configured global default", async function _EmptyTenantFallback()
	{
		const transaction = _Transaction();
		transaction.modelRoutingDefault.findMany.mockResolvedValue([
			{ scope: ModelRoutingScope.ClusterTenant, defaultModel: null },
			{ scope: ModelRoutingScope.Global, defaultModel: "global/model" },
		]);
		transaction.modelDefinition.findMany.mockResolvedValue([{ id: "global-definition", scope: ModelRoutingScope.Global }]);

		await expect(_Resolver(transaction).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Resolved, modelDefinitionId: "global-definition" });
	});

	it("fails closed when neither routing scope configures a model", async function _NoConfiguredModel()
	{
		const transaction = _Transaction();
		transaction.modelRoutingDefault.findMany.mockResolvedValue([]);

		await expect(_Resolver(transaction).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Unavailable });
		expect(transaction.modelDefinition.findMany).not.toHaveBeenCalled();
	});

	it("fails closed when the preferred accessible definition scope is ambiguous", async function _AmbiguousDefinitions()
	{
		const transaction = _Transaction();
		transaction.modelRoutingDefault.findMany.mockResolvedValue([{ scope: ModelRoutingScope.Global, defaultModel: "shared/model" }]);
		transaction.modelDefinition.findMany.mockResolvedValue([
			{ id: "tenant-a", scope: ModelRoutingScope.ClusterTenant },
			{ id: "tenant-b", scope: ModelRoutingScope.ClusterTenant },
			{ id: "global", scope: ModelRoutingScope.Global },
		]);

		await expect(_Resolver(transaction).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Ambiguous });
	});

	it("fails closed when only an inaccessible definition exists", async function _InaccessibleDefinition()
	{
		const transaction = _Transaction();
		transaction.modelRoutingDefault.findMany.mockResolvedValue([{ scope: ModelRoutingScope.Global, defaultModel: "foreign/model" }]);
		transaction.modelDefinition.findMany.mockResolvedValue([]);

		await expect(_Resolver(transaction).resolve("silo-a")).resolves.toEqual({ status: DefaultModelDefinitionResolutionStatuses.Unavailable });
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				publicModelName: "foreign/model",
				OR: [
					{ scope: ModelRoutingScope.ClusterTenant, clusterTenant: "silo-a" },
					{ scope: ModelRoutingScope.Global, clusterTenant: null },
				],
			},
		}));
	});
});
