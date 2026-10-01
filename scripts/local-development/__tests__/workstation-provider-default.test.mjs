import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { removePersistentLocalDevelopmentSecrets } from "../secrets.mjs";
import { persistWorkstationProviderDefault, readWorkstationProviderDefault, WORKSTATION_PROVIDER_DEFAULT_FILE } from "../workstation-provider-default.mjs";

/** Writes one owner-only provider key used to validate a persisted default. */
function _writeProviderKey(repositoryRoot, provider)
{
	const keysDirectory = path.join(repositoryRoot, "keys");
	fs.mkdirSync(keysDirectory, { recursive: true });
	fs.writeFileSync(path.join(keysDirectory, `.${provider}-key`), `${provider}-secret\n`, { mode: 0o600 });
}

test("a workstation default persists as the Tier 2 environment assignment", function _PersistedDefault()
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-default-"));

	try
	{
		_writeProviderKey(repositoryRoot, "openai");
		_writeProviderKey(repositoryRoot, "anthropic");
		assert.equal(persistWorkstationProviderDefault(repositoryRoot, "openai"), "openai");
		assert.equal(readWorkstationProviderDefault(repositoryRoot), "openai");
		const preferencePath = path.join(repositoryRoot, WORKSTATION_PROVIDER_DEFAULT_FILE);
		assert.equal(fs.readFileSync(preferencePath, "utf8"), "OPENCRANE_TIER2_DEFAULT_PROVIDER=openai\n");
		assert.equal(fs.statSync(preferencePath).mode & 0o077, 0);
		assert.throws(function _MissingCredentialDoesNotReplaceDefault()
		{
			persistWorkstationProviderDefault(repositoryRoot, "gemini");
		}, /requires keys\/\.gemini-key/u);
		assert.equal(readWorkstationProviderDefault(repositoryRoot), "openai");

		assert.equal(persistWorkstationProviderDefault(repositoryRoot, "anthropic"), "anthropic");
		assert.equal(readWorkstationProviderDefault(repositoryRoot), "anthropic");
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test("a workstation default fails closed for unsafe, malformed, or unconfigured values", function _InvalidDefault()
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-default-"));
	const preferencePath = path.join(repositoryRoot, WORKSTATION_PROVIDER_DEFAULT_FILE);

	try
	{
		_writeProviderKey(repositoryRoot, "openai");
		assert.throws(function _MissingCredential()
		{
			persistWorkstationProviderDefault(repositoryRoot, "anthropic");
		}, /requires keys\/\.anthropic-key/u);

		fs.writeFileSync(preferencePath, "OPENCRANE_TIER2_DEFAULT_PROVIDER=unreviewed\n", { mode: 0o600 });
		assert.throws(function _UnreviewedPreference()
		{
			readWorkstationProviderDefault(repositoryRoot);
		}, /not in the reviewed catalogue/u);

		fs.rmSync(preferencePath);
		fs.symlinkSync(path.join(repositoryRoot, "outside"), preferencePath);
		assert.throws(function _SymbolicPreference()
		{
			readWorkstationProviderDefault(repositoryRoot);
		}, /private regular file/u);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test("reset removes persistent service credentials without removing the workstation default", function _ResetPreservesDefault()
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-default-"));
	const persistentSecretsDirectory = path.join(repositoryRoot, "keys/tier2-local-development");

	try
	{
		_writeProviderKey(repositoryRoot, "openai");
		persistWorkstationProviderDefault(repositoryRoot, "openai");
		fs.mkdirSync(persistentSecretsDirectory, { recursive: true });
		fs.writeFileSync(path.join(persistentSecretsDirectory, "database-password"), "temporary\n", { mode: 0o600 });

		removePersistentLocalDevelopmentSecrets({ persistentSecretsDirectory });

		assert.equal(fs.existsSync(persistentSecretsDirectory), false);
		assert.equal(readWorkstationProviderDefault(repositoryRoot), "openai");
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});
