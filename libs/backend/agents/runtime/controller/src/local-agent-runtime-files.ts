import { timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { V1Job, V1Secret } from "@kubernetes/client-node";

import type { LocalAgentRuntimeAttemptFiles } from "./local-process-agent-controller-store.types";

/** Names of private files projected into one local attempt. */
const _RUNTIME_TOKEN_FILE_NAME = "runtime.token";
const _BOOTSTRAP_REFERENCE_FILE_NAME = "bootstrap.reference";
const _ATTEMPT_KEY_FILE_NAME = "litellm.key";

/** Return the bootstrap reference projected into the expected Pod annotations. */
function _BootstrapReference(job: V1Job): string
{
	const reference = job.spec?.template.metadata?.annotations?.["opencrane.ai/bootstrap-reference"];

	if (!reference)
	{
		throw new Error("local agent runtime requires the admitted bootstrap reference");
	}

	return reference;
}

/** Write a private file without exposing broader permissions between creation and chmod. */
async function _WritePrivateFile(path: string, value: string): Promise<void>
{
	await writeFile(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
	await chmod(path, 0o600);
}

/** Return the key from the create-only Secret projection. */
function _AttemptKey(secret: V1Secret): string
{
	const key = secret.stringData?.key;

	if (!key)
	{
		throw new Error("local agent runtime requires one attempt-scoped LiteLLM key");
	}

	return key;
}

/** Create one private attempt directory and project token and bootstrap files into it. */
export async function _CreateLocalAgentRuntimeFiles(job: V1Job, temporaryDirectoryRoot: string): Promise<LocalAgentRuntimeAttemptFiles>
{
	const directory = await mkdtemp(join(temporaryDirectoryRoot, "opencrane-agent-runtime-"));
	await chmod(directory, 0o700);
	const tokenPath = join(directory, _RUNTIME_TOKEN_FILE_NAME);
	const bootstrapPath = join(directory, _BOOTSTRAP_REFERENCE_FILE_NAME);
	const keyPath = join(directory, _ATTEMPT_KEY_FILE_NAME);

	try
	{
		await _WritePrivateFile(bootstrapPath, _BootstrapReference(job));
		return {
			directory,
			tokenPath,
			bootstrapPath,
			keyPath
		};
	}
	catch (err)
	{
		await rm(directory, { recursive: true, force: true });
		throw err;
	}
}

/** Write the signed per-attempt runtime bearer after its Pod UID has been generated. */
export async function _WriteLocalAgentRuntimeToken(files: LocalAgentRuntimeAttemptFiles, token: string): Promise<void>
{
	await writeFile(files.tokenPath, token, { encoding: "utf8", mode: 0o600, flag: "w" });
	await chmod(files.tokenPath, 0o600);
}

/** Accept a repeated key projection only when the existing private file holds the same key. */
export async function _EnsureLocalAgentRuntimeAttemptKey(files: LocalAgentRuntimeAttemptFiles, secret: V1Secret): Promise<void>
{
	const key = _AttemptKey(secret);

	try
	{
		await _WritePrivateFile(files.keyPath, key);
	}
	catch (err)
	{
		if ((err as NodeJS.ErrnoException).code !== "EEXIST")
		{
			throw err;
		}

		const current = Buffer.from(await readFile(files.keyPath, "utf8"));
		const expected = Buffer.from(key);

		if (current.length !== expected.length || !timingSafeEqual(current, expected))
		{
			throw new Error("local agent runtime refuses a different key for an existing attempt");
		}
	}
}
