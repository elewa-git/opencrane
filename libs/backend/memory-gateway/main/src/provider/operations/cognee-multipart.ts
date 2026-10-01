/** Encoder used to construct one replayable multipart request from validated strings. */
const _Encoder = new TextEncoder();

/** Concatenate multipart pieces without converting fact bytes back to text. */
function _Join(parts: readonly Uint8Array[]): Uint8Array
{
	const length = parts.reduce(function _AddLength(total, part) { return total + part.byteLength; }, 0);
	const joined = new Uint8Array(length);
	let offset = 0;
	for (const part of parts)
	{
		joined.set(part, offset);
		offset += part.byteLength;
	}
	return joined;
}

/** Build the pinned Add multipart body using a digest-derived boundary and safe filename. */
export function _BuildCogneeAddMultipart(datasetId: string, contentDigest: string, content: Uint8Array): { readonly body: Uint8Array; readonly contentType: string; readonly filename: string }
{
	const hex = contentDigest.slice("sha256:".length);
	const boundary = `opencrane-memory-${hex.slice(0, 32)}`;
	const filename = `fact-${hex}.txt`;
	const body = _Join([
		_Encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`),
		content,
		_Encoder.encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="datasetId"\r\n\r\n${datasetId}\r\n--${boundary}--\r\n`),
	]);
	return { body, contentType: `multipart/form-data; boundary=${boundary}`, filename };
}
