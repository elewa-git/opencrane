import { ___ParseAndValidateJson } from "@opencrane/util";

/** Maximum JSON response accepted from one internal controller authority call. */
const _MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Read a controller response body, refusing anything over 64 KiB, then validate the text.
 *
 * The limit is enforced twice: once against a declared `content-length`, and again chunk by chunk
 * while streaming, so a response that lies about or omits its length still cannot make the
 * controller allocate without bound. The stream is cancelled as soon as the limit is passed.
 *
 * Called by: every method of {@link __CreateHttpAgentControllerAuthority}.
 * @param response - The HTTP response, already known to have an acceptable status.
 * @param validate - The endpoint's validator, applied to the parsed JSON.
 * @param validatorArguments - Extra arguments the validator needs, such as the submitted command
 * it must correlate the answer against.
 * @returns The validated value.
 * @throws When the body exceeds 64 KiB, when there is no body, when the text is not valid JSON, or
 * when the validator rejects it.
 * @see {@link ___ParseAndValidateJson}
 */
export async function _ReadAndValidateAgentControllerJson<T, TArguments extends readonly unknown[]>(response: Response, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): Promise<T>
{
	const text = await _ReadBoundedText(response);
	return ___ParseAndValidateJson(text, "OpenCrane controller response", validate, ...validatorArguments);
}

async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane controller response exceeded the 64 KiB boundary");
		}
	}
	if (response.body === null) throw new Error("OpenCrane controller returned no response body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done) return Buffer.concat(chunks, byteLength).toString("utf8");
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane controller response exceeded the 64 KiB boundary");
		}
		chunks.push(result.value);
	}
}
