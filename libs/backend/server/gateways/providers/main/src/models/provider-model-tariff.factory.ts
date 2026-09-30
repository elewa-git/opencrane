import type { Prisma } from "@prisma/client";
import type { ModelTariffLookupPort } from "@opencrane/contracts";

import { __CreateConversationModelTariffLookup } from "@opencrane/backend/server/gateways/model-routing";

import { PrismaProviderModelTariffRepository } from "./prisma-provider-model-tariff-repository";

/**
 * Creates the validated tariff lookup over the caller's current database transaction.
 * The database clock selects the stored revision, and the existing model-routing wrapper may still
 * refuse it when the application clock falls outside that revision's validity window. The caller
 * must retain current run and model authority; this read does not replace the later database checks
 * performed when a physical request claims budget.
 * @param transaction Transaction that owns the model and tariff reads.
 * @returns A strict lookup that exposes no caller-supplied pricing.
 * @throws When model or tariff evidence is missing, ambiguous, inactive, or invalid.
 */
export function _CreateProviderModelTariffLookup(transaction: Prisma.TransactionClient): ModelTariffLookupPort
{
	const resolver = new PrismaProviderModelTariffRepository(transaction);
	return __CreateConversationModelTariffLookup(resolver);
}
