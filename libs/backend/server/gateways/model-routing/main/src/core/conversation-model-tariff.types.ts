import type { ModelTariffLookup, ModelTariffLookupPort, ModelTariffQuote } from "@opencrane/contracts";

/** Server-owned tariff resolver boundary; persistence decides the rates and revision. */
export interface ConversationModelTariffResolver
{
	/** Reads one model-bound quote without accepting caller-supplied pricing. */
	lookup(input: ModelTariffLookup): Promise<unknown>;
}

/** Local alias for the shared quote port consumed by budget admission. */
export type ConversationModelTariffLookupPort = ModelTariffLookupPort;

/** Local alias for the shared validated quote. */
export type ConversationModelTariffQuote = ModelTariffQuote;
