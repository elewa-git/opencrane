import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveLocalProviderSelection, resolveReviewedProviderRequest } from "./local-development/local-provider-selection.mjs";
import { readRequiredOwnerOnlySecret } from "./local-development/secrets.mjs";

const _CODESPACES_PROVIDER_KEY = "OPENCRANE_TIER3_PROVIDER_API_KEY";

function _readEnvironmentSecret(value)
{
	const secret = value?.trim() ?? "";
	if (!secret)
	{
		throw new Error(`${_CODESPACES_PROVIDER_KEY} is empty`);
	}
	if (/[\u0000-\u001f\u007f]/u.test(secret))
	{
		throw new Error(`${_CODESPACES_PROVIDER_KEY} contains a control character`);
	}
	return secret;
}

function _mergeSelection(optionValue, environmentValue, label)
{
	const normalizedEnvironmentValue = environmentValue?.trim() || undefined;
	if (optionValue && normalizedEnvironmentValue && optionValue !== normalizedEnvironmentValue)
	{
		throw new Error(`${label} disagrees with its Tier 3 environment setting`);
	}
	return optionValue ?? normalizedEnvironmentValue;
}

function _rejectTrackedProviderKey(repositoryRoot, providerKeyPath)
{
	if (!fs.existsSync(path.join(repositoryRoot, ".git")))
	{
		return;
	}
	const relativeKeyPath = path.relative(repositoryRoot, providerKeyPath);
	const trackedPath = execFileSync("git", ["ls-files", "--", relativeKeyPath], {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"]
	}).trim();
	if (trackedPath)
	{
		throw new Error(`Selected Tier 3 provider key must not be tracked by Git: ${relativeKeyPath}`);
	}
}

/**
 * Resolves the provider-backed Tier 3 profile before any cluster mutation or image build.
 *
 * A Codespaces key uses one purpose-specific environment variable and requires an explicit
 * provider. Without it, this path reuses Tier 2's reviewed `keys/.<provider>-key` discovery and
 * owner-only file checks. The returned key is handed only to `develop-smoke.sh`, which unsets it
 * before builds and scopes its deployment name to the release installer.
 *
 * Called by: `runTier3Development` for the `agent` profile.
 *
 * @param {{ model?: string, profile: "agent" | "infrastructure", provider?: string }} options - Parsed Tier 3 profile and selection.
 * @param {NodeJS.ProcessEnv} environment - Codespaces or local developer environment.
 * @param {string} repositoryRoot - OpenCrane checkout containing the registry and ignored keys directory.
 * @returns {{ apiKey: string, model: string, provider: string } | null} Exact interactive bootstrap, or null for credential-free infrastructure.
 * @throws When selection, provider/model ownership, or credential custody is invalid.
 */
export function resolveTier3ModelProvider(options, environment, repositoryRoot)
{
	if (options.profile === "infrastructure")
	{
		return null;
	}

	const registryPath = path.join(repositoryRoot, "libs/models/local-development/main/provider-contract.json");
	const provider = _mergeSelection(options.provider, environment.OPENCRANE_INITIAL_MODEL_PROVIDER, "--provider");
	const model = _mergeSelection(options.model, environment.OPENCRANE_INITIAL_MODEL_NAME, "--model");
	const environmentKey = environment[_CODESPACES_PROVIDER_KEY];
	delete environment[_CODESPACES_PROVIDER_KEY];
	if (environmentKey !== undefined)
	{
		if (!provider)
		{
			throw new Error(`${_CODESPACES_PROVIDER_KEY} requires --provider or OPENCRANE_INITIAL_MODEL_PROVIDER`);
		}
		const selection = resolveReviewedProviderRequest(registryPath, provider, model, undefined);
		return {
			apiKey: _readEnvironmentSecret(environmentKey),
			model: selection.model,
			provider: selection.provider.name
		};
	}

	const selection = resolveLocalProviderSelection({
		localProviderRegistryPath: registryPath,
		model,
		provider,
		providerKeysDirectory: path.join(repositoryRoot, "keys")
	});
	_rejectTrackedProviderKey(repositoryRoot, selection.providerKeyPath);
	return {
		apiKey: readRequiredOwnerOnlySecret(selection.providerKeyPath, "Selected Tier 3 provider key"),
		model: selection.selectedModel,
		provider: selection.selectedProvider.name
	};
}
