import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createTier3ProviderKeyEnvironmentVariable,
	discoverTier3ProviderCredentials,
	prepareTier3ProviderCredentials,
} from "../provider-credentials.mjs";

test("uses provider-specific Tier 3 Codespaces secret names", function _Names()
{
	assert.equal(createTier3ProviderKeyEnvironmentVariable({ name: "openai" }), "OPENAI_TIER3_PROVIDER_API_KEY");
	assert.equal(createTier3ProviderKeyEnvironmentVariable({ name: "azure-openai" }), "AZURE_OPENAI_TIER3_PROVIDER_API_KEY");
});

test("discovers reviewed credentials lexically and rejects unreviewed names", function _Discovery()
{
	const providers = [{ name: "openai" }, { name: "anthropic" }];
	const credentials = discoverTier3ProviderCredentials(providers, {
		OPENAI_TIER3_PROVIDER_API_KEY: "openai-key",
		ANTHROPIC_TIER3_PROVIDER_API_KEY: "anthropic-key",
	});
	assert.deepEqual(credentials.map((credential) => credential.provider.name), ["anthropic", "openai"]);
	assert.throws(function _Unknown()
	{
		discoverTier3ProviderCredentials(providers, { UNKNOWN_TIER3_PROVIDER_API_KEY: "unknown-key" });
	}, /unreviewed providers: UNKNOWN_TIER3_PROVIDER_API_KEY/u);
});

test("selects explicit, CLI-default, exported-default, then lexical Codespaces credentials", async function _Precedence()
{
	async function _Select(selection)
	{
		const environment = {
			CODESPACES: "true",
			ANTHROPIC_TIER3_PROVIDER_API_KEY: "anthropic-key",
			OPENAI_TIER3_PROVIDER_API_KEY: "openai-key",
			...selection.environment,
		};
		const result = await prepareTier3ProviderCredentials({
			defaultProvider: null,
			profile: "agent",
			provider: null,
			providerKeyFile: null,
			...selection.options,
		}, environment);
		assert.equal("ANTHROPIC_TIER3_PROVIDER_API_KEY" in environment, false);
		assert.equal("OPENAI_TIER3_PROVIDER_API_KEY" in environment, false);
		return { environment, result };
	}

	assert.deepEqual((await _Select({ options: { provider: "openai" } })).result, { provider: "openai", providerKey: "openai-key" });
	assert.deepEqual((await _Select({
		environment: { OPENCRANE_TIER3_DEFAULT_PROVIDER: "unreviewed" },
		options: { provider: "openai" },
	})).result, { provider: "openai", providerKey: "openai-key" });
	const cliDefault = await _Select({ options: { defaultProvider: "openai" } });
	assert.deepEqual(cliDefault.result, { provider: "openai", providerKey: "openai-key" });
	assert.equal(cliDefault.environment.OPENCRANE_TIER3_DEFAULT_PROVIDER, "openai");
	assert.deepEqual((await _Select({ environment: { OPENCRANE_TIER3_DEFAULT_PROVIDER: "openai" } })).result, { provider: "openai", providerKey: "openai-key" });
	assert.deepEqual((await _Select({})).result, { provider: "anthropic", providerKey: "anthropic-key" });
});

test("fails closed for missing selections and Codespaces key files", async function _CodespacesFailures()
{
	const base = { defaultProvider: null, profile: "agent", provider: null, providerKeyFile: null };
	await assert.rejects(
		prepareTier3ProviderCredentials({ ...base, provider: "unreviewed" }, { CODESPACES: "true", OPENAI_TIER3_PROVIDER_API_KEY: "openai-key" }),
		/provider must be one of/u,
	);
	await assert.rejects(
		prepareTier3ProviderCredentials({ ...base, provider: "openai" }, { CODESPACES: "true", ANTHROPIC_TIER3_PROVIDER_API_KEY: "anthropic-key" }),
		/OPENAI_TIER3_PROVIDER_API_KEY Codespaces secret/u,
	);
	await assert.rejects(
		prepareTier3ProviderCredentials({ ...base, provider: "openai", providerKeyFile: "/tmp/key" }, { CODESPACES: "true", OPENAI_TIER3_PROVIDER_API_KEY: "openai-key" }),
		/refuses --provider-key-file/u,
	);
	await assert.rejects(
		prepareTier3ProviderCredentials(base, { CODESPACES: "true" }),
		/requires one reviewed provider secret/u,
	);
});

test("retains owner-only workstation files and scrubs inherited Tier 3 secrets", async function _Workstation()
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-tier3-provider-"));
	const path = join(directory, "provider-key");

	try
	{
		await writeFile(path, "workstation-key\n", { mode: 0o600 });
		const environment = { OPENAI_TIER3_PROVIDER_API_KEY: "must-not-leak" };
		const result = await prepareTier3ProviderCredentials({
			defaultProvider: "openai",
			profile: "agent",
			provider: null,
			providerKeyFile: path,
		}, environment);
		assert.deepEqual(result, { provider: "openai", providerKey: "workstation-key" });
		assert.equal("OPENAI_TIER3_PROVIDER_API_KEY" in environment, false);
		assert.equal(environment.OPENCRANE_TIER3_DEFAULT_PROVIDER, "openai");
	}
	finally
	{
		await rm(directory, { recursive: true, force: true });
	}
});

test("scrubs provider credentials from the infrastructure worker environment", async function _Infra()
{
	const environment = { OPENAI_TIER3_PROVIDER_API_KEY: "must-not-reach-smoke" };
	const result = await prepareTier3ProviderCredentials({ profile: "infra" }, environment);
	assert.equal(result, null);
	assert.equal("OPENAI_TIER3_PROVIDER_API_KEY" in environment, false);
});
