/** Divide non-negative integers and round any remainder upward. */
export function _CeilingDivide(numerator: bigint, denominator: bigint): bigint
{
	if (numerator < 0n || denominator <= 0n)
		throw new Error("managed budget calculation requires non-negative value and positive denominator");
	return numerator === 0n ? 0n : ((numerator - 1n) / denominator) + 1n;
}

/** Price bounded token counts with one exact upward rounding at the final EUR-micro boundary. */
export function _PriceEurMicros(inputTokens: number, outputTokens: number, inputRate: bigint, outputRate: bigint, tokenUnit: bigint): bigint
{
	if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0 || inputRate < 0n || outputRate < 0n)
		throw new Error("managed budget pricing requires bounded non-negative token counts and rates");
	return _CeilingDivide((BigInt(inputTokens) * inputRate) + (BigInt(outputTokens) * outputRate), tokenUnit);
}
