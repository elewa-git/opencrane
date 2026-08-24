/**
 * Parse JSON text and validate the result in one step, so parsed data is never used untyped.
 *
 * `JSON.parse` returns `unknown` on purpose. This forces a validator to run immediately, so a
 * caller cannot accidentally cast a parsed boundary value into `T`. Extra arguments are passed
 * straight to the validator, so a caller needing request context does not have to write a
 * one-off wrapper.
 *
 * Called by: `libs/backend/artifacts/authorization/main/src/artifact-lease.ts`,
 * `libs/backend/artifacts/preprocessor/main/src/remote.ts`,
 * `libs/backend/channel-proxy/main/src/target-resolver.ts`,
 * `libs/backend/agents/runtime/controller/src/http-agent-controller-response.ts`,
 * `libs/backend/server/conversations/main/src/replay-cursor.ts`.
 * @param value - Raw JSON text from an untrusted source.
 * @param sourceName - Label used in the syntax-error message; it appears in logs, so keep it non-sensitive.
 * @param validate - Validator that returns `T` or throws.
 * @param validatorArguments - Extra arguments passed unchanged to `validate`.
 * @returns The validated value.
 * @throws Error when the text is not valid JSON. The message names `sourceName` and deliberately does not include the text itself.
 * @throws Whatever `validate` throws, unchanged, so a domain error keeps its own type.
 * @see {@link JsonValue}
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
