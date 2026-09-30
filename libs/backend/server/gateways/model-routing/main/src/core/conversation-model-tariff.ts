import { ___ModelTariffLookupSchema, ___ModelTariffQuoteSchema, ___ModelTariffSchema, type ModelTariff, type ModelTariffLookup, type ModelTariffLookupPort, type ModelTariffQuote } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationModelTariffResolver } from "./conversation-model-tariff.types";

/** Calculates one completion-bound quote from validated immutable tariff evidence. */
export function __QuoteConversationModelTariff(tariff: ModelTariff, maxCompletionTokens: number): ModelTariffQuote
{
	const checkedTariff = ___ModelTariffSchema.parse(tariff);
	const unit = BigInt(checkedTariff.tokenUnit);
	const total = BigInt(checkedTariff.maxInputTokens) * BigInt(checkedTariff.inputEurMicrosPerUnit) + BigInt(maxCompletionTokens) * BigInt(checkedTariff.outputEurMicrosPerUnit);
	return ___ModelTariffQuoteSchema.parse({ tariff: checkedTariff, maxCompletionTokens, worstCaseEurMicros: ((total + unit - 1n) / unit).toString() });
}

/** Wraps a tariff resolver with strict request, quote and model-binding validation. */
export function __CreateConversationModelTariffLookup(resolver: ConversationModelTariffResolver): ModelTariffLookupPort
{
	return {
		async lookup(input): Promise<ModelTariffQuote>
		{
			const checkedInput = ___ModelTariffLookupSchema.parse(input);
			const quote = ___ModelTariffQuoteSchema.parse(await resolver.lookup(checkedInput));
			if (quote.tariff.modelAlias !== checkedInput.modelAlias)
				throw new Error("Conversation model tariff is bound to a different model");
			if (quote.maxCompletionTokens !== checkedInput.maxCompletionTokens)
				throw new Error("Conversation model tariff completion ceiling is not bound to the request");
			const now = Date.now();
			if (now < Date.parse(quote.tariff.effectiveAt) || now >= Date.parse(quote.tariff.validUntil))
				throw new Error("Conversation model tariff is outside its validity window");
			const { digest, ...identity } = quote.tariff;
			if (___DigestCanonicalJson(identity as unknown as JsonValue) !== digest)
				throw new Error("Conversation model tariff digest does not match its identity");
			const expectedQuote = __QuoteConversationModelTariff(quote.tariff, checkedInput.maxCompletionTokens);
			if (quote.worstCaseEurMicros !== expectedQuote.worstCaseEurMicros)
				throw new Error("Conversation model tariff worst-case quote does not match its rates");
			return quote;
		},
	};
}
