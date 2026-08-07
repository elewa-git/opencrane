import { readFileSync } from "node:fs";

/**
 * Read one artifact credential only from an absolute, read-only mounted file.
 *
 * Artifact capability keys must not travel through process environment values,
 * command-line arguments, or logs. The caller owns the key's purpose; this
 * loader only validates that the mounted material is recognisably PEM encoded.
 * @param path - Mounted absolute file path supplied by process configuration.
 * @param name - Configuration name used in fail-closed validation messages.
 * @returns PEM-encoded key material for an in-process signer or verifier.
 */
export function _ReadArtifactMountedPem(path: string | undefined, name: string): string
{
	if (path === undefined || !path.startsWith("/")) throw new Error(`${name} must identify an absolute mounted key path`);
	const value = readFileSync(path, "utf8");
	if (!value.includes("-----BEGIN ") || !value.includes(" KEY-----")) throw new Error(`${name} must contain a PEM key`);
	return value;
}
