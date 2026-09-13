import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { __CreateCogneeProviderCredentialFileReader } from "../cognee-provider-credential-file-reader";

/** Temporary directories removed after each credential-reader case. */
const _directories: string[] = [];

afterEach(async function _Cleanup()
{
	const { rm } = await import("node:fs/promises");
	await Promise.all(_directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

/** Create two synthetic mounted files and return their fixed paths. */
async function _Files(email: string, password: string): Promise<{ readonly emailPath: string; readonly passwordPath: string }>
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-cognee-credential-"));
	_directories.push(directory);
	const emailPath = join(directory, "email");
	const passwordPath = join(directory, "password");
	await Promise.all([writeFile(emailPath, email), writeFile(passwordPath, password)]);
	return { emailPath, passwordPath };
}

describe("Cognee provider credential file reader", function _Suite()
{
	it("reads both mounted values without retaining their line endings", async function _Reads()
	{
		const files = await _Files("memory-gateway@example.invalid\n", "test-only-password\n");
		const reader = __CreateCogneeProviderCredentialFileReader(files);
		await expect(reader.read()).resolves.toEqual({ email: "memory-gateway@example.invalid", password: "test-only-password" });
	});

	it("refuses relative and oversized credential files", async function _Bounds()
	{
		const files = await _Files("memory-gateway@example.invalid", "x".repeat(4_097));
		const reader = __CreateCogneeProviderCredentialFileReader(files);
		await expect(reader.read()).rejects.toThrow(/invalid size/u);
		const relative = __CreateCogneeProviderCredentialFileReader({ emailPath: "email", passwordPath: files.passwordPath });
		await expect(relative.read()).rejects.toThrow(/must be absolute/u);
	});

	it("refuses malformed UTF-8 instead of changing credential bytes", async function _Encoding()
	{
		const directory = await mkdtemp(join(tmpdir(), "opencrane-cognee-credential-"));
		_directories.push(directory);
		const emailPath = join(directory, "email");
		const passwordPath = join(directory, "password");
		await Promise.all([writeFile(emailPath, Buffer.from([0xc3, 0x28])), writeFile(passwordPath, "test-only-password")]);
		const reader = __CreateCogneeProviderCredentialFileReader({ emailPath, passwordPath });
		await expect(reader.read()).rejects.toThrow();
	});
});
