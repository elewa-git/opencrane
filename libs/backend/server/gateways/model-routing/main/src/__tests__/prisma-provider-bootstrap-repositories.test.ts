import type { Prisma, ProviderCredential } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaGlobalModelRoutingDefaultRepository } from "../core/prisma-global-model-routing-default-repository";
import { PrismaGlobalProviderCredentialProjectionRepository } from "../core/prisma-provider-credential-projection-repository";

const _credentialRow: ProviderCredential = {
	id: "credential-1",
	scope: "Global",
	clusterTenant: null,
	provider: "openai",
	secretRef: "byok-provider-key-openai",
	litellmCredentialName: "byok-openai",
	createdAt: new Date("2026-08-28T10:00:00.000Z"),
	updatedAt: new Date("2026-08-28T10:01:00.000Z"),
};

describe("provider bootstrap Prisma repositories", function _Suite()
{
	it("converges a concurrent first provider-credential projection writer", async function _ConvergesCredentialRace()
	{
		const providerCredential = {
			findFirst: vi.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(_credentialRow),
			create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
			update: vi.fn().mockResolvedValue(_credentialRow),
		};
		const prisma = { providerCredential } as unknown as Prisma.TransactionClient;
		const repository = new PrismaGlobalProviderCredentialProjectionRepository(prisma);
		const command = {
			provider: "openai",
			secretRef: "byok-provider-key-openai",
			litellmCredentialName: "byok-openai",
		};

		await expect(repository.upsertGlobal(command)).resolves.toEqual({
			id: "credential-1",
			litellmCredentialName: "byok-openai",
			updatedAt: new Date("2026-08-28T10:01:00.000Z"),
		});
		expect(providerCredential.update).toHaveBeenCalledWith({
			where: { id: "credential-1" },
			data: {
				secretRef: "byok-provider-key-openai",
				litellmCredentialName: "byok-openai",
			},
		});
	});

	it("fails closed when a provider-credential uniqueness error has no visible winner", async function _RejectsMissingCredentialWinner()
	{
		const uniqueError = Object.assign(new Error("unique"), { code: "P2002" });
		const providerCredential = {
			findFirst: vi.fn().mockResolvedValue(null),
			create: vi.fn().mockRejectedValue(uniqueError),
		};
		const prisma = { providerCredential } as unknown as Prisma.TransactionClient;
		const repository = new PrismaGlobalProviderCredentialProjectionRepository(prisma);
		const command = {
			provider: "openai",
			secretRef: "byok-provider-key-openai",
			litellmCredentialName: null,
		};

		await expect(repository.upsertGlobal(command)).rejects.toBe(uniqueError);
	});

	it("converges a concurrent first Global routing-default writer", async function _ConvergesRoutingRace()
	{
		const modelRoutingDefault = {
			findFirst: vi.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: "routing-1" }),
			create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
		};
		const prisma = { modelRoutingDefault } as unknown as Prisma.TransactionClient;
		const repository = new PrismaGlobalModelRoutingDefaultRepository(prisma);

		await expect(repository.ensureFirst("openai/gpt-5.5")).resolves.toBeUndefined();
		expect(modelRoutingDefault.create).toHaveBeenCalledWith({
			data: {
				scope: "Global",
				clusterTenant: null,
				defaultModel: "openai/gpt-5.5",
			},
		});
	});

	it("fails closed when a routing-default uniqueness error has no visible winner", async function _RejectsMissingRoutingWinner()
	{
		const uniqueError = Object.assign(new Error("unique"), { code: "P2002" });
		const modelRoutingDefault = {
			findFirst: vi.fn().mockResolvedValue(null),
			create: vi.fn().mockRejectedValue(uniqueError),
		};
		const prisma = { modelRoutingDefault } as unknown as Prisma.TransactionClient;
		const repository = new PrismaGlobalModelRoutingDefaultRepository(prisma);

		await expect(repository.ensureFirst("openai/gpt-5.5")).rejects.toBe(uniqueError);
	});
});
