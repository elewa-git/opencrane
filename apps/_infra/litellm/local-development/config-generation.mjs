import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Names the sole environment variable a generated local provider configuration can read. */
const LOCAL_PROVIDER_KEY_ENVIRONMENT_VARIABLE = "OPENCRANE_LOCAL_PROVIDER_KEY";

function _createSecretFreeConfiguration(model)
{
	return [
		"model_list:",
		"  - model_name: auto",
		"    litellm_params:",
		`      model: ${JSON.stringify(model)}`,
		`      api_key: os.environ/${LOCAL_PROVIDER_KEY_ENVIRONMENT_VARIABLE}`,
		"litellm_settings:",
		"  drop_params: true",
		""
	].join("\n");
}

function _requireRealDirectory(directoryPath)
{
	const statistics = fs.lstatSync(directoryPath);

	if (statistics.isSymbolicLink() || !statistics.isDirectory())
	{
		throw new Error(`The local LiteLLM configuration path must be a real directory: ${directoryPath}`);
	}
}

/**
 * Writes one already-selected provider/model into session-owned secret-free LiteLLM YAML.
 *
 * Called by: the Tier 2 coordinator only after `createModelCredentialPlan` selects `local-llm`.
 * @param {{ selection: { provider: { name: string }, model: string }, generatedDirectory: string }} options - Reviewed selection and output directory.
 * @returns {{ generatedConfigPath: string, providerKeyEnvironmentVariable: string }} Isolated launch inputs.
 */
export function prepareLocalLiteLLMConfiguration(options)
{
	const selection = options.selection;
	const generatedDirectory = options.generatedDirectory;
	if (!generatedDirectory)
	{
		throw new Error("The local LiteLLM configuration requires a session-owned output directory");
	}
	_requireRealDirectory(generatedDirectory);
	const digest = crypto.createHash("sha256").update(selection.model).digest("hex").slice(0, 16);
	const generatedConfigPath = path.join(generatedDirectory, `${selection.provider.name}-${digest}.generated.yaml`);
	fs.writeFileSync(generatedConfigPath, _createSecretFreeConfiguration(selection.model), { encoding: "utf8", flag: "wx", mode: 0o600 });

	return {
		generatedConfigPath,
		providerKeyEnvironmentVariable: LOCAL_PROVIDER_KEY_ENVIRONMENT_VARIABLE
	};
}
