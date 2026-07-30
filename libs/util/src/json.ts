/**
 * Parse one JSON string and immediately validate its untrusted result into a caller-owned type.
 *
 * JSON syntax parsing deliberately produces `unknown`; only the injected validator can turn that
 * boundary value into `T`. Additional validator arguments let callers pass contextual constraints
 * without creating one-off parsing wrappers.
 *
 * @param value - Raw JSON text from an untrusted configuration or transport boundary.
 * @param sourceName - Stable source label included in syntax-error diagnostics.
 * @param validate - Domain validator that either returns `T` or throws a domain-specific error.
 * @param validatorArguments - Additional contextual constraints passed unchanged to the validator.
 * @returns The fully validated caller-owned value.
 */
export function ___ParseAndValidateJson<T, TArguments extends readonly unknown[]>(value: string, sourceName: string, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): T
{
	let candidate: unknown;
	try
	{
		candidate = JSON.parse(value) as unknown;
	}
	catch (cause)
	{
		throw new Error(`${sourceName} must contain valid JSON`, { cause });
	}
	return validate(candidate, ...validatorArguments);
}
