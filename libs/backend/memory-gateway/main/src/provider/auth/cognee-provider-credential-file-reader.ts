import { open } from "node:fs/promises";

import type { CogneeProviderCredentialFileOptions } from "./cognee-provider-credential-file-reader.types";
import type { CogneeProviderCredentialReader } from "./cognee-provider-session.types";

/** Largest single mounted credential value accepted from the Kubernetes Secret volume. */
const _MAX_CREDENTIAL_BYTES = 4_096;

/** Read one mounted UTF-8 value through a fixed byte ceiling and remove only its trailing line break. */
async function _ReadCredential(path: string): Promise<string>
{
	if (!path.startsWith("/"))
		throw new Error("Cognee credential path must be absolute");
	const file = await open(path, "r");
	try
	{
		const buffer = Buffer.alloc(_MAX_CREDENTIAL_BYTES + 1);
		const result = await file.read(buffer, 0, buffer.byteLength, 0);
		if (result.bytesRead === 0 || result.bytesRead > _MAX_CREDENTIAL_BYTES)
			throw new Error("Cognee credential file has an invalid size");
		return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, result.bytesRead)).replace(/\r?\n$/u, "");
	}
	finally
	{
		await file.close();
	}
}

/**
 * Create the mounted-file reader for one per-silo Cognee service user.
 *
 * The reader loads fresh values for every login attempt, returns no file metadata, and applies a
 * fixed byte limit before the session validator checks the email and password shapes. Callers must
 * pass the two read-only Secret file paths and must treat every rejection as provider unavailable.
 *
 * Called by: apps/memory-gateway/src/index.ts during process composition.
 *
 * @param options - Absolute email and password paths in the gateway's Secret volume.
 * @returns A credential reader consumed only by the in-process Cognee provider session.
 * @throws Error When a path is relative, a file cannot be read, or a value is empty or oversized.
 */
export function __CreateCogneeProviderCredentialFileReader(options: CogneeProviderCredentialFileOptions): CogneeProviderCredentialReader
{
	return {
		async read()
		{
			const [email, password] = await Promise.all([
				_ReadCredential(options.emailPath),
				_ReadCredential(options.passwordPath),
			]);
			return { email, password };
		},
	};
}
