import { ___ParseAndValidateJson } from "@opencrane/util";

/** Maximum JSON response accepted from one internal controller authority call. */
const _MAX_RESPONSE_BYTES = 64 * 1024;

/** Read a response under the fixed byte ceiling before applying its endpoint-specific validator. */
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
