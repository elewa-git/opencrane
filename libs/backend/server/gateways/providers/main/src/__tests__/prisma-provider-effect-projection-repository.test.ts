import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";

import { PrismaProviderEffectProjectionRepository } from "../prisma-provider-effect-projection-repository";
import { ProviderEffectCommandKinds, type ProviderEffectCommandRecord, type ProviderEffectHandlerResult } from "../provider-effect-command.types";

/** Builds the exact non-secret Set-BYOK command needed by projection tests. */
function _command(): ProviderEffectCommandRecord
{
	return { id: "command-a", siloId: "silo-a", principalId: "principal-a", resourceId: "byok:silo-a:openai", payload: { kind: ProviderEffectCommandKinds.SetByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } } as ProviderEffectCommandRecord;
}

/** Builds confirmed chat and embedding evidence returned by external reconciliation. */
function _result(): Extract<ProviderEffectHandlerResult, { readonly kind: ProviderEffectCommandKinds.SetByokKey }>
{
	return {
		kind: ProviderEffectCommandKinds.SetByokKey,
		provider: "openai",
		secretRef: "byok-provider-key-openai",
		litellmCredentialName: "byok-openai",
		models: [
			{ publicModelName: "openai/gpt-5.5", upstreamModel: "openai/gpt-5.5", litellmModelId: "deployment-flagship" },
			{ publicModelName: "openai/gpt-5.4", upstreamModel: "openai/gpt-5.4", litellmModelId: "deployment-balanced" },
			{ publicModelName: "openai/gpt-5.4-nano", upstreamModel: "openai/gpt-5.4-nano", litellmModelId: "deployment-fast" },
		],
		embedding: {
			status: ProviderEmbeddingReconciliationStatuses.Confirmed,
			deployments: [
				{ publicModelName: "openai/text-embedding-3-large", upstreamModel: "openai/text-embedding-3-large", litellmModelId: "deployment-embedding" },
				{ publicModelName: "auto-embedding", upstreamModel: "openai/text-embedding-3-large", litellmModelId: "deployment-auto-embedding" },
			],
		},
	};
}

describe("PrismaProviderEffectProjectionRepository", function _Suite()
{
	it("updates the same-silo credential and keeps embedding evidence out of chat ModelDefinition", async function _ProjectsProviderModels()
	{
		const credentialUpdate = vi.fn(async function _UpdateCredential() { return {}; });
		let modelSequence = 0;
		const modelCreate = vi.fn(async function _CreateModel() { modelSequence += 1; return { id: `model-${modelSequence}` }; });
		const transaction = {
			providerCredential: {
				findFirst: vi.fn(async function _FindCredential() { return { id: "byok:silo-a:openai" }; }),
				update: credentialUpdate,
			},
			modelDefinition: {
				findFirst: vi.fn(async function _FindModel() { return null; }),
				create: modelCreate,
			},
		} as unknown as Prisma.TransactionClient;

		const resources = await new PrismaProviderEffectProjectionRepository(transaction).persist(_command(), _result());

		expect(credentialUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id_siloId: { id: "byok:silo-a:openai", siloId: "silo-a" } } }));
		expect(modelCreate).toHaveBeenCalledTimes(3);
		expect(modelCreate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ publicModelName: "auto-embedding" }) }));
		expect(modelCreate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ publicModelName: "openai/text-embedding-3-large" }) }));
		expect(resources).toEqual([
			{ kind: "provider-connection", id: "byok:silo-a:openai" },
			{ kind: "model-definition", id: "model-1" },
			{ kind: "model-definition", id: "model-2" },
			{ kind: "model-definition", id: "model-3" },
		]);
	});

	it("rejects embedding evidence that does not match the fixed provider catalogue", async function _RejectsEmbeddingMismatch()
	{
		const modelCreate = vi.fn();
		const transaction = {
			providerCredential: { findFirst: vi.fn(async function _FindCredential() { return { id: "byok:silo-a:openai" }; }), update: vi.fn() },
			modelDefinition: { findFirst: vi.fn(), create: modelCreate },
		} as unknown as Prisma.TransactionClient;
		const result = { ..._result(), embedding: { ..._result().embedding, deployments: [] } } as never;

		await expect(new PrismaProviderEffectProjectionRepository(transaction).persist(_command(), result)).rejects.toThrow("embedding projection");
		expect(modelCreate).not.toHaveBeenCalled();
	});
});
