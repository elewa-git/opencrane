import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createLocalDevelopmentConfiguration } from "../configuration.mjs";

/** Escape one reviewed image coordinate before matching its YAML owner. */
function _Pattern(value)
{
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("Tier 2 operand images stay aligned with the current deployment profiles", function _OperandPins()
{
	const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
	const configuration = createLocalDevelopmentConfiguration({ profile: "core" }, repositoryRoot, {});
	const deploymentValues = fs.readFileSync(path.join(repositoryRoot, "apps/_infra/deploy-k8s/values.yaml"), "utf8");
	const smokeValues = fs.readFileSync(path.join(repositoryRoot, "apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml"), "utf8");
	const [kurrentRepository, kurrentDigest] = configuration.kurrentImage.split("@");
	const [liteLLMTaggedRepository, liteLLMDigest] = configuration.liteLLMImage.split("@");
	const tagSeparator = liteLLMTaggedRepository.lastIndexOf(":");
	const liteLLMRepository = liteLLMTaggedRepository.slice(0, tagSeparator);
	const liteLLMTag = liteLLMTaggedRepository.slice(tagSeparator + 1);

	assert.match(deploymentValues, new RegExp(`repository: ${_Pattern(kurrentRepository)}`, "u"));
	assert.match(smokeValues, new RegExp(`digest: ${_Pattern(kurrentDigest)}`, "u"));
	assert.match(deploymentValues, new RegExp(`repository: ${_Pattern(liteLLMRepository)}`, "u"));
	assert.match(deploymentValues, new RegExp(`tag: ${_Pattern(liteLLMTag)}`, "u"));
	assert.match(liteLLMDigest, /^sha256:[a-f0-9]{64}$/u);
	assert.equal(configuration.liteLLMImage, "ghcr.io/berriai/litellm-non_root:main-v1.81.9-stable@sha256:868fc4bf07e06f53681c838728edc81b9ecf871a741f807132bac1be5468f8a3");
	assert.equal(configuration.postgresVolumeProvisionerContainerName.startsWith("opencrane-tier2-postgres-volume-"), true);
	assert.equal(configuration.sessionLockPath.endsWith(`${configuration.worktreeIdentity}.lock`), true);
});

test("Codespaces uses only its exact private port 4200 browser origin", function _CodespaceOrigin()
{
	const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
	const environment = {
		CODESPACES: "true",
		CODESPACE_NAME: "careful-crane-123",
		GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
		OPENCRANE_TIER2_DEFAULT_PROVIDER: " openai ",
	};
	const configuration = createLocalDevelopmentConfiguration({ profile: "core" }, repositoryRoot, environment);
	assert.equal(configuration.browserOrigin, "https://careful-crane-123-4200.app.github.dev");
	assert.equal(configuration.codespaceName, "careful-crane-123");
	assert.equal(configuration.defaultProvider, "openai");
	function _UnexpectedPersistence()
	{
		throw new Error("Codespaces must not use the workstation preference file");
	}
	const operations = {
		persistWorkstationProviderDefault: _UnexpectedPersistence,
		readWorkstationProviderDefault: _UnexpectedPersistence,
	};
	const overridden = createLocalDevelopmentConfiguration({
		profile: "agent",
		alternative: "local-llm",
		defaultProvider: "anthropic",
	}, repositoryRoot, environment, operations);
	assert.equal(overridden.defaultProvider, "anthropic");

	const invalidEnvironment = { ...environment, CODESPACE_NAME: "bad.example.com" };
	assert.throws(function _InvalidOrigin()
	{
		createLocalDevelopmentConfiguration({ profile: "core" }, repositoryRoot, invalidEnvironment);
	}, /valid CODESPACE_NAME/u);
});

test("workstations persist a CLI default and load it into later worker environments", function _WorkstationDefault()
{
	const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
	const firstEnvironment = {};
	let persistedProvider;
	function _PersistDefault(_repositoryRoot, provider)
	{
		persistedProvider = provider;
		return provider;
	}
	function _ReadDefault()
	{
		return "openai";
	}
	const operations = {
		persistWorkstationProviderDefault: _PersistDefault,
		readWorkstationProviderDefault: _ReadDefault,
	};
	const selected = createLocalDevelopmentConfiguration({
		profile: "agent",
		alternative: "local-llm",
		defaultProvider: "anthropic",
	}, repositoryRoot, firstEnvironment, operations);

	assert.equal(persistedProvider, "anthropic");
	assert.equal(selected.defaultProvider, "anthropic");
	assert.equal(firstEnvironment.OPENCRANE_TIER2_DEFAULT_PROVIDER, "anthropic");

	const laterEnvironment = {};
	const later = createLocalDevelopmentConfiguration({
		profile: "agent",
		alternative: "local-llm",
	}, repositoryRoot, laterEnvironment, operations);
	assert.equal(later.defaultProvider, "openai");
	assert.equal(laterEnvironment.OPENCRANE_TIER2_DEFAULT_PROVIDER, "openai");

	const exportedEnvironment = { OPENCRANE_TIER2_DEFAULT_PROVIDER: "gemini" };
	const exported = createLocalDevelopmentConfiguration({
		profile: "agent",
		alternative: "local-llm",
	}, repositoryRoot, exportedEnvironment, operations);
	assert.equal(exported.defaultProvider, "gemini");
});

test("an explicit workstation provider or model does not read a stored fallback", function _ExplicitSelection()
{
	const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
	function _UnexpectedRead()
	{
		throw new Error("Explicit selection must not read the stored fallback");
	}
	const operations = { readWorkstationProviderDefault: _UnexpectedRead };
	const provider = createLocalDevelopmentConfiguration({
		profile: "agent",
		alternative: "local-llm",
		provider: "openai",
	}, repositoryRoot, {}, operations);
	assert.equal(provider.provider, "openai");
	assert.equal(provider.defaultProvider, undefined);

	const model = createLocalDevelopmentConfiguration({
		profile: "agent",
		alternative: "local-llm",
		model: "openai/gpt-5.5",
	}, repositoryRoot, {}, operations);
	assert.equal(model.model, "openai/gpt-5.5");
	assert.equal(model.defaultProvider, undefined);
});
