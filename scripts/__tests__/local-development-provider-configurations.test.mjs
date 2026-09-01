import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDevelopmentConfiguration } from "../local-development/configuration.mjs";
import { prepareLocalProviderConfiguration } from "../local-development/local-provider-configurations.mjs";
import { parseLocalDevelopmentArguments } from "../local-development/profiles.mjs";

const _PROVIDER_CONTRACT_PATH = new URL("../../libs/models/local-development/main/provider-contract.json", import.meta.url);

function _temporaryRepository(t)
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-provider-config-test-"));
	const contractDirectory = path.join(repositoryRoot, "libs/models/local-development/main");
	fs.mkdirSync(path.join(repositoryRoot, "keys"), { recursive: true });
	fs.mkdirSync(path.join(repositoryRoot, "apps/_infra/litellm/local-development"), { recursive: true });
	fs.mkdirSync(contractDirectory, { recursive: true });
	fs.copyFileSync(_PROVIDER_CONTRACT_PATH, path.join(contractDirectory, "provider-contract.json"));
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });

	return repositoryRoot;
}

function _writeKey(repositoryRoot, provider, secret = `${provider}-secret`)
{
	const keyFile = `.${provider}-key`;
	fs.writeFileSync(path.join(repositoryRoot, "keys", keyFile), `${secret}\n`, { mode: 0o600 });
}

function _configuration(repositoryRoot, selection = {})
{
	const argumentsList = ["--profile", "agent"];

	if (selection.provider)
	{
		argumentsList.push("--provider", selection.provider);
	}

	if (selection.model)
	{
		argumentsList.push("--model", selection.model);
	}

	return createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(argumentsList), repositoryRoot, {});
}

test("no provider or model selects the first hidden provider key and creates only its persistent configuration", function _DefaultSelection(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "openai");
	_writeKey(repositoryRoot, "anthropic");
	_writeKey(repositoryRoot, "gemini");
	_writeKey(repositoryRoot, "mistral");
	_writeKey(repositoryRoot, "cohere");
	fs.writeFileSync(path.join(repositoryRoot, "keys/.remote-litellm-admin-key"), "remote-secret\n", { mode: 0o600 });
	const configuration = _configuration(repositoryRoot);
	const prepared = prepareLocalProviderConfiguration(configuration);

	assert.equal(prepared.selectedProvider, "anthropic");
	assert.equal(prepared.selectedModel, "anthropic/claude-sonnet-4-5-20250929");
	assert.equal(prepared.providerKeyPath, path.join(repositoryRoot, "keys/.anthropic-key"));
	assert.deepEqual(fs.readdirSync(configuration.localLiteLLMConfigurationDirectory), [path.basename(prepared.liteLLMConfigPath)]);
	assert.equal(fs.statSync(prepared.liteLLMConfigPath).mode & 0o777, 0o644);
	const selectedConfiguration = fs.readFileSync(prepared.liteLLMConfigPath, "utf8");
	assert.match(selectedConfiguration, /model_name: auto/);
	assert.match(selectedConfiguration, /model: "anthropic\/claude-sonnet-4-5-20250929"/);
	assert.match(selectedConfiguration, /api_key: os\.environ\/OPENCRANE_LOCAL_PROVIDER_KEY/);
	assert.equal(selectedConfiguration.includes("openai-secret"), false);
	const reused = prepareLocalProviderConfiguration(configuration);
	assert.equal(reused.liteLLMConfigPath, prepared.liteLLMConfigPath);
});

test("an exact reviewed model overrides the first key and creates only its provider configuration", function _RequestedModel(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "anthropic");
	_writeKey(repositoryRoot, "openai");
	const prepared = prepareLocalProviderConfiguration(_configuration(repositoryRoot, { model: "openai/gpt-5.4-nano" }));

	assert.equal(prepared.selectedProvider, "openai");
	assert.equal(prepared.providerKeyPath, path.join(repositoryRoot, "keys/.openai-key"));
	assert.deepEqual(fs.readdirSync(_configuration(repositoryRoot).localLiteLLMConfigurationDirectory), [path.basename(prepared.liteLLMConfigPath)]);
	assert.match(fs.readFileSync(prepared.liteLLMConfigPath, "utf8"), /model: "openai\/gpt-5.4-nano"/);
});

test("an exact provider overrides the first key and uses its default model", function _RequestedProvider(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "anthropic");
	_writeKey(repositoryRoot, "openai");
	const prepared = prepareLocalProviderConfiguration(_configuration(repositoryRoot, { provider: "openai" }));

	assert.equal(prepared.selectedProvider, "openai");
	assert.equal(prepared.selectedModel, "openai/gpt-5.4-nano");
	assert.equal(prepared.providerKeyPath, path.join(repositoryRoot, "keys/.openai-key"));
});

test("a model must belong to an explicitly selected provider", function _MismatchedProviderAndModel(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "anthropic");
	_writeKey(repositoryRoot, "openai");

	assert.throws(function _prepareMismatch()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot, {
			provider: "anthropic",
			model: "openai/gpt-5.4-nano"
		}));
	}, /does not belong to provider anthropic/);
});

test("a model is accepted when it belongs to the explicitly selected provider", function _MatchingProviderAndModel(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "anthropic");
	_writeKey(repositoryRoot, "openai");
	const prepared = prepareLocalProviderConfiguration(_configuration(repositoryRoot, {
		provider: "openai",
		model: "openai/gpt-5.4-nano"
	}));

	assert.equal(prepared.selectedProvider, "openai");
	assert.equal(prepared.selectedModel, "openai/gpt-5.4-nano");
});

test("an unreviewed provider fails before any persistent configuration is returned", function _UnknownProvider(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "openai");

	assert.throws(function _prepareUnknownProvider()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot, { provider: "cohere" }));
	}, /is not listed in the reviewed local model registry/);
});

test("an unreviewed model fails before any persistent configuration is returned", function _UnknownModel(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "openai");

	assert.throws(function _prepareUnknownModel()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot, { model: "openai/unreviewed-model" }));
	}, /is not listed in the reviewed local model registry/);
});

test("a reviewed model fails when its derived provider key is missing", function _MissingProviderKey(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "openai");

	assert.throws(function _prepareMissingProvider()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot, { model: "anthropic/claude-sonnet-4-5-20250929" }));
	}, /Provider anthropic requires the missing key file keys\/\.anthropic-key/);
});

test("a reviewed provider fails when its derived key is missing", function _MissingExplicitProviderKey(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "openai");

	assert.throws(function _prepareMissingProvider()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot, { provider: "anthropic" }));
	}, /Provider anthropic requires the missing key file keys\/\.anthropic-key/);
});

test("Alternative A fails clearly when keys contains no recognized provider file", function _NoProviderKeys(t)
{
	const repositoryRoot = _temporaryRepository(t);
	_writeKey(repositoryRoot, "cohere");

	assert.throws(function _prepareWithoutRecognizedKeys()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot));
	}, /requires one reviewed provider key/);
});

test("the reviewed registry rejects duplicate model authority", function _DuplicateModel(t)
{
	const repositoryRoot = _temporaryRepository(t);
	const registryPath = path.join(repositoryRoot, "libs/models/local-development/main/provider-contract.json");
	fs.writeFileSync(registryPath, JSON.stringify({
		providers: [
			{
				name: "first",
				defaultModel: "shared/model",
				models: ["shared/model"]
			},
			{
				name: "second",
				defaultModel: "shared/model",
				models: ["shared/model"]
			}
		]
	}), { mode: 0o600 });
	_writeKey(repositoryRoot, "first");

	assert.throws(function _prepareAmbiguousRegistry()
	{
		prepareLocalProviderConfiguration(_configuration(repositoryRoot));
	}, /repeats model shared\/model/);
});
