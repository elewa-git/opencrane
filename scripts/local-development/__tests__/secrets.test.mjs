import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDevelopmentSecrets, removeLocalDevelopmentSecrets } from "../secrets.mjs";

/** Create every output file that the isolated OpenSSL plan declares. */
async function _CreateOpenSslOutputs(_command, argumentsList)
{
	for (const option of ["-keyout", "-out"])
	{
		const index = argumentsList.indexOf(option);
		if (index >= 0)
		{
			fs.writeFileSync(argumentsList[index + 1], "test material\n", { mode: 0o600 });
		}
	}
}

/** Supply only the paths and profile inputs needed by secret construction. */
function _Configuration(persistentSecretsDirectory, alternative = "simulated-llm")
{
	return {
		abortSignal: new AbortController().signal,
		alternative,
		persistentSecretsDirectory,
	};
}

test("session secrets use the current conversation keyring contract", async function _CurrentKeyring()
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-secret-test-"));
	let secrets;
	function _Bytes(size)
	{
		return Buffer.alloc(size, 7);
	}

	function _DifferentBytes(size)
	{
		return Buffer.alloc(size, 8);
	}

	try
	{
		secrets = await createLocalDevelopmentSecrets(_Configuration(path.join(root, "persistent")), {
			randomBytes: _Bytes,
			runCommand: _CreateOpenSslOutputs,
		});
		const keyring = JSON.parse(fs.readFileSync(secrets.conversationKeyringPath, "utf8"));
		assert.equal(keyring.currentKeyId, "tier2-persistent");
		assert.equal("activeKeyId" in keyring, false);
		assert.equal(typeof keyring.keys["tier2-persistent"], "string");
		const firstKey = keyring.keys["tier2-persistent"];
		removeLocalDevelopmentSecrets(secrets);
		secrets = await createLocalDevelopmentSecrets(_Configuration(path.join(root, "persistent")), {
			randomBytes: _DifferentBytes,
			runCommand: _CreateOpenSslOutputs,
		});
		const reusedKeyring = JSON.parse(fs.readFileSync(secrets.conversationKeyringPath, "utf8"));
		assert.equal(reusedKeyring.keys["tier2-persistent"], firstKey);
	}
	finally
	{
		if (secrets)
		{
			removeLocalDevelopmentSecrets(secrets);
		}
		fs.rmSync(root, { force: true, recursive: true });
	}
});

test("local LiteLLM keeps a database credential distinct from the product database owner", async function _LiteLLMDatabaseCredential()
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-litellm-secret-test-"));
	const persistent = path.join(root, "persistent");
	let secrets;
	function _Bytes(size)
	{
		return Buffer.alloc(size, 9);
	}

	function _DifferentBytes(size)
	{
		return Buffer.alloc(size, 10);
	}

	try
	{
		secrets = await createLocalDevelopmentSecrets(_Configuration(persistent, "local-llm"), {
			randomBytes: _Bytes,
			runCommand: _CreateOpenSslOutputs,
		});
		const firstLiteLLMPassword = secrets.liteLLMDatabasePassword;
		assert.notEqual(firstLiteLLMPassword, secrets.postgresPassword);
		assert.equal(fs.statSync(path.join(persistent, "litellm-database-password")).mode & 0o077, 0);
		removeLocalDevelopmentSecrets(secrets);
		secrets = await createLocalDevelopmentSecrets(_Configuration(persistent, "local-llm"), {
			randomBytes: _DifferentBytes,
			runCommand: _CreateOpenSslOutputs,
		});
		assert.equal(secrets.liteLLMDatabasePassword, firstLiteLLMPassword);
	}
	finally
	{
		if (secrets)
		{
			removeLocalDevelopmentSecrets(secrets);
		}
		fs.rmSync(root, { force: true, recursive: true });
	}
});

test("secret construction removes its session directory after an early credential failure", async function _EarlyFailureCleanup()
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-secret-failure-"));
	const persistent = path.join(root, "persistent");
	const session = path.join(root, "session");
	fs.mkdirSync(persistent);
	fs.writeFileSync(path.join(persistent, "postgres-password"), "exposed\n", { mode: 0o644 });
	function _SessionDirectory()
	{
		fs.mkdirSync(session);

		return session;
	}

	try
	{
		await assert.rejects(createLocalDevelopmentSecrets(_Configuration(persistent), {
			makeTemporaryDirectory: _SessionDirectory,
			runCommand: _CreateOpenSslOutputs,
		}), /private regular file/);
		assert.equal(fs.existsSync(session), false);
	}
	finally
	{
		fs.rmSync(root, { force: true, recursive: true });
	}
});
