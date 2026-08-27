import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveLocalProviderSelection } from "./local-provider-selection.mjs";

const _PROVIDER_KEY_ENVIRONMENT_VARIABLE = "OPENCRANE_LOCAL_PROVIDER_KEY";

function _createLiteLLMConfiguration(model)
{
	return [
		"model_list:",
		"  - model_name: auto",
		"    litellm_params:",
		`      model: ${JSON.stringify(model)}`,
		`      api_key: os.environ/${_PROVIDER_KEY_ENVIRONMENT_VARIABLE}`,
		"litellm_settings:",
		"  drop_params: true",
		""
	].join("\n");
}

function _ensureConfigurationDirectory(directoryPath)
{
	if (!fs.existsSync(directoryPath))
	{
		fs.mkdirSync(directoryPath, { recursive: true });
		return;
	}

	const statistics = fs.lstatSync(directoryPath);

	if (statistics.isSymbolicLink() || !statistics.isDirectory())
	{
		throw new Error(`The local LiteLLM configuration path must be a real directory: ${directoryPath}`);
	}
}

function _readExistingConfiguration(configurationPath, expectedConfiguration)
{
	const statistics = fs.lstatSync(configurationPath);

	if (statistics.isSymbolicLink() || !statistics.isFile())
	{
		throw new Error(`The local LiteLLM configuration must be a regular file: ${configurationPath}`);
	}

	if (fs.readFileSync(configurationPath, "utf8") !== expectedConfiguration)
	{
		throw new Error(`The local LiteLLM configuration does not match the reviewed model; remove it to regenerate: ${configurationPath}`);
	}
}

/**
 * Resolves one provider/model and creates its persistent secret-free LiteLLM configuration once.
 * The file stays under the ignored local LiteLLM source directory and is reused while its bytes
 * still match the reviewed registry. Only the selected provider's credential is read by the later
 * secret-loading step, and only this selected configuration is mounted into LiteLLM.
 *
 * Called by: `runLocalDevelopmentSession` after repository validation and before secret loading.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Tier 2 local-LLM configuration and optional default-model selection.
 * @returns The selected provider/model and its exact configuration and credential paths.
 * @throws When selection fails or the persistent configuration boundary is unsafe or stale.
 */
export function prepareLocalProviderConfiguration(configuration)
{
	const selection = resolveLocalProviderSelection(configuration);
	const configurationDirectory = configuration.localLiteLLMConfigurationDirectory;
	_ensureConfigurationDirectory(configurationDirectory);
	// The digest gives each reviewed model a filesystem-safe name that later sessions can reuse.
	const modelDigest = crypto.createHash("sha256").update(selection.selectedModel).digest("hex").slice(0, 16);
	const liteLLMConfigPath = path.join(configurationDirectory, `${selection.selectedProvider.name}-${modelDigest}.generated.yaml`);
	const expectedConfiguration = _createLiteLLMConfiguration(selection.selectedModel);
	if (fs.existsSync(liteLLMConfigPath))
	{
		_readExistingConfiguration(liteLLMConfigPath, expectedConfiguration);
	}
	else
	{
		// The pinned non-root LiteLLM container needs read access, and this file contains no credential.
		fs.writeFileSync(liteLLMConfigPath, expectedConfiguration, { encoding: "utf8", mode: 0o644, flag: "wx" });
	}

	return {
		liteLLMConfigPath,
		providerKeyPath: selection.providerKeyPath,
		selectedProvider: selection.selectedProvider.name,
		selectedModel: selection.selectedModel
	};
}
