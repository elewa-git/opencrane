/** Versioned EUR tariff identity and rates supplied by the server-owned tariff authority. */
export interface ModelTariff
{
	/** Version of the serialized tariff shape and calculation rule. */
	readonly version: 1;
	/** Exact admitted model alias this tariff prices. */
	readonly modelAlias: string;
	/** Currency is fixed to EUR for the hard-budget wave. */
	readonly currency: "EUR";
	/** Decimal numerator for input EUR micros per token unit. */
	readonly inputEurMicrosPerUnit: string;
	/** Decimal numerator for completion EUR micros per token unit. */
	readonly outputEurMicrosPerUnit: string;
	/** Explicit denominator for the two decimal rate numerators. */
	readonly tokenUnit: 1_000_000;
	/** Maximum input tokens this tariff identity covers. */
	readonly maxInputTokens: number;
	/** Positive tariff revision selected by the authority. */
	readonly revision: number;
	/** Inclusive UTC validity start for this tariff identity. */
	readonly effectiveAt: string;
	/** Exclusive UTC validity end for this tariff identity. */
	readonly validUntil: string;
	/** Digest of the complete versioned tariff record excluding this field. */
	readonly digest: string;
}

/** Inputs for a server-owned tariff lookup; no caller-provided rate is accepted. */
export interface ModelTariffLookup
{
	/** Silo whose tariff authority owns the model price. */
	readonly siloId: string;
	/** Exact model alias being admitted. */
	readonly modelAlias: string;
	/** Reserved completion ceiling used to calculate the worst-case bound. */
	readonly maxCompletionTokens: number;
}

/** Frozen tariff evidence and worst-case EUR micros returned before dispatch. */
export interface ModelTariffQuote
{
	/** Tariff identity and rates used for this quote. */
	readonly tariff: ModelTariff;
	/** Completion ceiling bound into this quote; it must equal the lookup request. */
	readonly maxCompletionTokens: number;
	/** Worst-case EUR micros for the requested completion ceiling. */
	readonly worstCaseEurMicros: string;
}

/** Server-owned lookup port used by the budget admission owner. */
export interface ModelTariffLookupPort
{
	/** Returns a validated model-bound EUR tariff and worst-case quote. */
	lookup(input: ModelTariffLookup): Promise<ModelTariffQuote>;
}
