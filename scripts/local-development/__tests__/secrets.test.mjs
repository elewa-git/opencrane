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
function _Configuration(persistentSecretsDirectory)
{
	return {
		abortSignal: new AbortController().signal,
		alternative: "simulated-llm",
		persistentSecretsDirectory,
	};
}

test("session secrets use the current conversation keyring contract", async function _CurrentKeyring()
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-secret-test-"));
	let secrets;
	try
	{
		secrets = await createLocalDevelopmentSecrets(_Configuration(path.join(root, "persistent")), {
			randomBytes: function _Bytes(size) { return Buffer.alloc(size, 7); },
			runCommand: _CreateOpenSslOutputs,
		});
		const keyring = JSON.parse(fs.readFileSync(secrets.conversationKeyringPath, "utf8"));
		assert.equal(keyring.currentKeyId, "tier2-persistent");
		assert.equal("activeKeyId" in keyring, false);
		assert.equal(typeof keyring.keys["tier2-persistent"], "string");
		const firstKey = keyring.keys["tier2-persistent"];
		removeLocalDevelopmentSecrets(secrets);
		secrets = await createLocalDevelopmentSecrets(_Configuration(path.join(root, "persistent")), {
			randomBytes: function _DifferentBytes(size) { return Buffer.alloc(size, 8); },
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

test("secret construction removes its session directory after an early credential failure", async function _EarlyFailureCleanup()
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-secret-failure-"));
	const persistent = path.join(root, "persistent");
	const session = path.join(root, "session");
	fs.mkdirSync(persistent);
	fs.writeFileSync(path.join(persistent, "postgres-password"), "exposed\n", { mode: 0o644 });
	try
	{
		await assert.rejects(createLocalDevelopmentSecrets(_Configuration(persistent), {
			makeTemporaryDirectory: function _SessionDirectory()
			{
				fs.mkdirSync(session);
				return session;
			},
			runCommand: _CreateOpenSslOutputs
		}), /private regular file/);
		assert.equal(fs.existsSync(session), false);
	}
	finally
	{
		fs.rmSync(root, { force: true, recursive: true });
	}
});
