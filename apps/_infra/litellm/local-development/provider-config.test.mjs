import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepareLocalLiteLLMConfiguration } from "./config-generation.mjs";
import { createModelCredentialPlan, readLocalProviderCatalog, resolveLocalProviderSelection } from "./provider-selection.mjs";

const _PUBLIC_CATALOG_PATH = fileURLToPath(new URL("../../../../libs/backend/server/gateways/model-routing/main/byok-provider-catalog.json", import.meta.url));

function _TemporaryRepository()
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-litellm-test-"));
	fs.mkdirSync(path.join(repositoryRoot, "keys"));
	fs.mkdirSync(path.join(repositoryRoot, "generated"));
	return repositoryRoot;
}

function _WriteKey(repositoryRoot, provider, value = `${provider}-secret`)
{
	const keyPath = path.join(repositoryRoot, "keys", `.${provider}-key`);
	fs.writeFileSync(keyPath, `${value}\n`, { mode: 0o600 });
	return keyPath;
}

test("selection consumes the model-routing public catalogue without divergence", function _Authority()
{
	const providers = readLocalProviderCatalog();
	const publicCatalog = JSON.parse(fs.readFileSync(_PUBLIC_CATALOG_PATH, "utf8"));
	const projectedCatalog = Object.fromEntries(providers.map((provider) => {
		const publicProvider = publicCatalog[provider.name];

		return [provider.name, {
			litellmProvider: provider.litellmProvider,
			defaultModel: provider.defaultModel,
			models: provider.models,
			embeddingModel: publicProvider.embeddingModel,
		}];
	}));
	const expectedCatalog = Object.fromEntries(Object.entries(publicCatalog).map(([name, provider]) => {
		return [name, {
			litellmProvider: provider.litellmProvider,
			defaultModel: provider.models.find((model) => model.className === provider.defaultClass)?.slug,
			models: provider.models.map((model) => model.slug),
			embeddingModel: provider.embeddingModel,
		}];
	}));

	assert.deepEqual(projectedCatalog, expectedCatalog);
	assert.deepEqual(providers.map((provider) => provider.name).sort(), [
		"anthropic",
		"deepseek",
		"gemini",
		"glm",
		"mistral",
		"openai",
	]);
	assert.equal(providers.find((provider) => provider.name === "openai")?.defaultModel, "openai/gpt-5.5");
	assert.equal(providers.find((provider) => provider.name === "glm")?.litellmProvider, "zai");
});

test("selection is deterministic and enforces provider ownership", function _Selection()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		_WriteKey(repositoryRoot, "openai");
		_WriteKey(repositoryRoot, "anthropic");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot }).provider.name, "anthropic");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot, defaultProvider: "openai" }).provider.name, "openai");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot, provider: "anthropic", defaultProvider: "openai" }).provider.name, "anthropic");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot, provider: "openai" }).model, "openai/gpt-5.5");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot, model: "openai/gpt-5.4" }).provider.name, "openai");
		assert.throws(function _Mismatch()
		{
			resolveLocalProviderSelection({
				repositoryRoot,
				provider: "anthropic",
				model: "openai/gpt-5.4",
			});
		}, /does not belong/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test("credentials must be owner-only regular files", function _CredentialBoundary()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		const keyPath = _WriteKey(repositoryRoot, "openai");
		fs.chmodSync(keyPath, 0o644);
		assert.throws(function _PublicFile() { resolveLocalProviderSelection({ repositoryRoot, provider: "openai" }); }, /readable only by its owner/);
		fs.rmSync(keyPath);
		fs.symlinkSync(path.join(repositoryRoot, "outside"), keyPath);
		assert.throws(function _Symlink() { resolveLocalProviderSelection({ repositoryRoot, provider: "openai" }); }, /regular, non-symbolic-link/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test("Codespaces selects explicit, default, or alphabetically first provider credentials", function _CodespacesSelection()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		const environment = {
			OPENAI_TIER2_PROVIDER_API_KEY: "openai-secret",
			ANTHROPIC_TIER2_PROVIDER_API_KEY: "anthropic-secret",
		};
		const codespacesOptions = {
			alternative: "local-llm",
			codespaceName: "careful-crane-123",
			provider: "openai",
			model: "openai/gpt-5.4",
			repositoryRoot,
		};
		const plan = createModelCredentialPlan(codespacesOptions, environment);
		assert.equal(plan.kind, "local");
		assert.equal(plan.credentialSource, "codespaces-environment");
		assert.equal(plan.selection.provider.name, "openai");
		assert.equal(plan.selection.model, "openai/gpt-5.4");
		assert.equal(plan.selection.providerKeyEnvironmentVariable, "OPENAI_TIER2_PROVIDER_API_KEY");
		assert.equal(plan.selection.providerKeyPath, undefined);

		const automatic = createModelCredentialPlan({
			alternative: "local-llm",
			codespaceName: "careful-crane-123",
			repositoryRoot,
		}, environment);
		assert.equal(automatic.selection.provider.name, "anthropic");
		const defaulted = createModelCredentialPlan({
			alternative: "local-llm",
			codespaceName: "careful-crane-123",
			defaultProvider: "openai",
			repositoryRoot,
		}, environment);
		assert.equal(defaulted.selection.provider.name, "openai");
		assert.throws(function _ProviderMismatch()
		{
			const mismatchedProviderOptions = {
				alternative: "local-llm",
				codespaceName: "careful-crane-123",
				provider: "anthropic",
				model: "openai/gpt-5.4",
				repositoryRoot,
			};
			createModelCredentialPlan(mismatchedProviderOptions, environment);
		}, /does not belong/u);
		assert.throws(function _MissingSelectedCredential()
		{
			createModelCredentialPlan({
				alternative: "local-llm",
				codespaceName: "careful-crane-123",
				provider: "gemini",
				repositoryRoot,
			}, environment);
		}, /GEMINI_TIER2_PROVIDER_API_KEY/u);
		assert.throws(function _UnreviewedCredential()
		{
			createModelCredentialPlan({
				alternative: "local-llm",
				codespaceName: "careful-crane-123",
				repositoryRoot,
			}, { UNREVIEWED_TIER2_PROVIDER_API_KEY: "secret" });
		}, /unreviewed providers/u);
		assert.throws(function _RetiredGenericCredential()
		{
			createModelCredentialPlan({
				alternative: "local-llm",
				codespaceName: "careful-crane-123",
				repositoryRoot,
			}, { OPENCRANE_TIER2_PROVIDER_API_KEY: "secret" });
		}, /OPENCRANE_TIER2_PROVIDER_API_KEY/u);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test("generated configuration contains only the selected alias and environment reference", function _SecretFreeConfiguration()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		_WriteKey(repositoryRoot, "openai", "never-write-this-secret");
		const generatedDirectory = path.join(repositoryRoot, "generated");
		const selection = resolveLocalProviderSelection({
			repositoryRoot,
			provider: "openai",
			model: "openai/gpt-5.4",
		});
		const prepared = prepareLocalLiteLLMConfiguration({ selection, generatedDirectory });
		const content = fs.readFileSync(prepared.generatedConfigPath, "utf8");
		assert.match(content, /model_name: auto/);
		assert.match(content, /model: "openai\/gpt-5\.4"/);
		assert.match(content, /api_key: os\.environ\/OPENCRANE_LOCAL_PROVIDER_KEY/);
		assert.doesNotMatch(content, /never-write-this-secret/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test("remote and simulated alternatives stay isolated from local provider credentials", function _AlternativeIsolation()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		const localKey = _WriteKey(repositoryRoot, "openai");
		const remoteKey = path.join(repositoryRoot, "remote-admin-key");
		fs.writeFileSync(remoteKey, "remote-secret\n", { mode: 0o600 });
		assert.deepEqual(createModelCredentialPlan({ alternative: "simulated-llm", repositoryRoot }), { kind: "simulated" });
		assert.equal(createModelCredentialPlan({
			alternative: "remote-llm",
			repositoryRoot,
			remoteLiteLLMMasterKeyFile: remoteKey,
		}).remoteMasterKeyPath, remoteKey);
		assert.throws(function _Reuse()
		{
			createModelCredentialPlan({
				alternative: "remote-llm",
				repositoryRoot,
				remoteLiteLLMMasterKeyFile: localKey,
			});
		}, /must not reuse/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});
