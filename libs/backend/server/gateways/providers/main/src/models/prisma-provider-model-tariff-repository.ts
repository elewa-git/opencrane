import type { Prisma } from "@prisma/client";
import type { ModelTariffLookup, ModelTariffQuote } from "@opencrane/contracts";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __QuoteConversationModelTariff, type ConversationModelTariffResolver } from "@opencrane/backend/server/gateways/model-routing";

/** Reads one unambiguous, active EUR tariff for an admitted model alias. */
export class PrismaProviderModelTariffRepository implements ConversationModelTariffResolver
{
	/** Transaction that keeps the model, clock and tariff reads together. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds tariff resolution to the caller's open transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	lookup(input: ModelTariffLookup): Promise<ModelTariffQuote>
	{
		const transaction = this.transaction;
		return ___DoWithTrace("provider.model-tariff.lookup", { siloId: input.siloId, modelAlias: input.modelAlias }, async function _LookupTariff()
		{
			const models = await transaction.modelDefinition.findMany({
				where: { siloId: input.siloId, publicModelName: input.modelAlias },
				select: { id: true, litellmModelId: true },
				take: 2,
			});
			if (models.length !== 1)
				throw new Error("Conversation model tariff requires one unambiguous model alias");
			const model = models[0]!;
			if (model.litellmModelId.startsWith("pending:"))
				throw new Error("Conversation model tariff requires a registered model");

			const now = (await transaction.agentRunAuthorityClock.findUniqueOrThrow({ where: { singleton: 1 }, select: { now: true } })).now;
			const tariffs = await transaction.modelEurTariffRevision.findMany({
				where: { siloId: input.siloId, modelDefinitionId: model.id, effectiveAt: { lte: now }, validUntil: { gt: now } },
				orderBy: { revision: "desc" },
				take: 2,
			});
			if (tariffs.length !== 1)
				throw new Error("Conversation model tariff requires one active revision");
			const tariff = tariffs[0]!;
			if (tariff.tokenUnit !== 1_000_000n)
				throw new Error("Conversation model tariff has an unsupported token unit");
			return __QuoteConversationModelTariff({
				version: 1,
				modelAlias: input.modelAlias,
				currency: "EUR",
				inputEurMicrosPerUnit: tariff.inputEurMicrosPerUnit.toString(),
				outputEurMicrosPerUnit: tariff.outputEurMicrosPerUnit.toString(),
				tokenUnit: 1_000_000,
				maxInputTokens: tariff.maxInputTokens,
				revision: tariff.revision,
				effectiveAt: tariff.effectiveAt.toISOString(),
				validUntil: tariff.validUntil.toISOString(),
				digest: tariff.digest,
			}, input.maxCompletionTokens);
		});
	}
}
