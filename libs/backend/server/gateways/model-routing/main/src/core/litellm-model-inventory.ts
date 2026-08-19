import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

/**
 * Requires one public model name to exist in LiteLLM's live inventory.
 *
 * Called by: the final initial-model bootstrap assertion after catalogue reconciliation.
 *
 * @param publicModelName - The public name that must appear in the live inventory.
 * @throws When LiteLLM is unconfigured, unavailable, malformed, or missing the name.
 */
export async function _RequireLiteLlmModelName(publicModelName: string): Promise<void>
{
	const deployments = await _ReadConfiguredLiteLlmModelDeployments();
	if (!deployments.has(publicModelName))
	{
		throw new Error(`LiteLLM has not registered required model '${publicModelName}'`);
	}
}

/**
 * Requires one immutable deployment identity to remain registered under its public model name.
 *
 * Called by: strict BYOK bootstrap reconciliation for every persisted `ModelDefinition`.
 *
 * @param publicModelName - The public name stored by the model definition.
 * @param expectedModelId - The immutable LiteLLM deployment id stored by the model definition.
 * @throws When LiteLLM is unconfigured, unavailable, malformed, missing the name, or missing the id.
 */
export async function _RequireLiteLlmModelDeployment(publicModelName: string, expectedModelId: string): Promise<void>
{
	const deployments = await _ReadConfiguredLiteLlmModelDeployments();
	const deploymentIds = deployments.get(publicModelName);
	if (!deploymentIds)
	{
		throw new Error(`LiteLLM has not registered required model '${publicModelName}'`);
	}
	if (!deploymentIds.has(expectedModelId))
	{
		throw new Error(`LiteLLM has not registered required deployment '${expectedModelId}' for model '${publicModelName}'`);
	}
}

/**
 * Reads and validates LiteLLM's model inventory using explicit connection material.
 *
 * Called by: embedding reconciliation, which catches failures before registering absent names,
 * and the strict qualification functions in this file, which propagate every failure.
 *
 * @param endpoint - LiteLLM endpoint without a route suffix.
 * @param masterKey - LiteLLM administrative bearer token.
 * @returns Deployment ids grouped by public model name.
 * @throws When the request fails, the response is non-successful, or the inventory is malformed.
 * @see https://docs.litellm.ai/docs/proxy/model_management for LiteLLM's `GET /model/info` inventory contract.
 */
export async function _ReadLiteLlmModelDeployments(endpoint: string, masterKey: string): Promise<Map<string, Set<string>>>
{
	return ___DoWithTrace(
		"litellm.model.inventory",
		{},
		async function _ReadInventory(): Promise<Map<string, Set<string>>>
		{
			const response = await fetch(`${endpoint}/model/info`, {
				headers: { Authorization: `Bearer ${masterKey}` },
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok)
			{
				throw new Error(`LiteLLM model inventory returned HTTP ${response.status}`);
			}
			return ___ParseAndValidateJson(await response.text(), "LiteLLM model inventory response", _RegisteredModelDeployments);
		},
	);
}

/** Reads the live inventory using the deployment's configured LiteLLM connection. */
async function _ReadConfiguredLiteLlmModelDeployments(): Promise<Map<string, Set<string>>>
{
	const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
	const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
	if (!endpoint || !masterKey)
	{
		throw new Error("LiteLLM endpoint and master key are required to validate the initial model");
	}
	return _ReadLiteLlmModelDeployments(endpoint, masterKey);
}

/**
 * Validates LiteLLM inventory names and collects every deployment id registered under each name.
 *
 * Called by: `_ReadLiteLlmModelDeployments` before any caller trusts inventory contents.
 *
 * @returns The deployment ids grouped by model name; a name with no reported id maps to an empty set.
 * @throws When the inventory, its data, an entry, a name, or a present model id has the wrong shape.
 */
function _RegisteredModelDeployments(value: unknown): Map<string, Set<string>>
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("LiteLLM model inventory must be an object");
	const data = (value as Record<string, unknown>)["data"];
	if (data === undefined) return new Map();
	if (!Array.isArray(data)) throw new Error("LiteLLM model inventory data must be an array");
	const deployments = new Map<string, Set<string>>();
	for (const entry of data)
	{
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error("LiteLLM model inventory entry must be an object");
		const modelName = (entry as Record<string, unknown>)["model_name"];
		if (modelName === undefined) continue;
		if (typeof modelName !== "string") throw new Error("LiteLLM model inventory name must be a string");
		const ids = deployments.get(modelName) ?? new Set<string>();
		deployments.set(modelName, ids);
		const modelInfo = (entry as Record<string, unknown>)["model_info"];
		if (modelInfo === undefined) continue;
		if (typeof modelInfo !== "object" || modelInfo === null || Array.isArray(modelInfo)) throw new Error("LiteLLM model inventory model_info must be an object");
		const id = (modelInfo as Record<string, unknown>)["id"];
		if (id === undefined) continue;
		if (typeof id !== "string") throw new Error("LiteLLM model inventory id must be a string");
		ids.add(id);
	}
	return deployments;
}
