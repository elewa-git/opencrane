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
	const projectedCatalog = Object.fromEntries(providers.map(function _Project(provider)
	{
		const publicProvider = publicCatalog[provider.name];
		return [provider.name, {
			litellmProvider: provider.litellmProvider,
			defaultModel: provider.defaultModel,
			models: provider.models,
			embeddingModel: publicProvider.embeddingModel,
		}];
	}));
	const expectedCatalog = Object.fromEntries(Object.entries(publicCatalog).map(function _Project([name, provider])
	{
		return [name, {
			litellmProvider: provider.litellmProvider,
			defaultModel: provider.models.find(function _Default(model) { return model.className === provider.defaultClass; })?.slug,
			models: provider.models.map(function _Slug(model) { return model.slug; }),
			embeddingModel: provider.embeddingModel,
		}];
	}));

	assert.deepEqual(projectedCatalog, expectedCatalog);
	assert.deepEqual(providers.map(function _Name(provider) { return provider.name; }).sort(), ["anthropic", "deepseek", "gemini", "glm", "mistral", "openai"]);
	assert.equal(providers.find(function _OpenAi(provider) { return provider.name === "openai"; })?.defaultModel, "openai/gpt-5.5");
	assert.equal(providers.find(function _Glm(provider) { return provider.name === "glm"; })?.litellmProvider, "zai");
});

test("selection is deterministic and enforces provider ownership", function _Selection()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		_WriteKey(repositoryRoot, "openai");
		_WriteKey(repositoryRoot, "anthropic");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot }).provider.name, "anthropic");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot, provider: "openai" }).model, "openai/gpt-5.5");
		assert.equal(resolveLocalProviderSelection({ repositoryRoot, model: "openai/gpt-5.4" }).provider.name, "openai");
		assert.throws(function _Mismatch() { resolveLocalProviderSelection({ repositoryRoot, provider: "anthropic", model: "openai/gpt-5.4" }); }, /does not belong/);
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

test("generated configuration contains only the selected alias and environment reference", function _SecretFreeConfiguration()
{
	const repositoryRoot = _TemporaryRepository();
	try
	{
		_WriteKey(repositoryRoot, "openai", "never-write-this-secret");
		const generatedDirectory = path.join(repositoryRoot, "generated");
		const selection = resolveLocalProviderSelection({ repositoryRoot, provider: "openai", model: "openai/gpt-5.4" });
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
		assert.equal(createModelCredentialPlan({ alternative: "remote-llm", repositoryRoot, remoteLiteLLMMasterKeyFile: remoteKey }).remoteMasterKeyPath, remoteKey);
		assert.throws(function _Reuse() { createModelCredentialPlan({ alternative: "remote-llm", repositoryRoot, remoteLiteLLMMasterKeyFile: localKey }); }, /must not reuse/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { recursive: true, force: true });
	}
});
