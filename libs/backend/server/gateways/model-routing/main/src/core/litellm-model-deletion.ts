import type { Logger } from "@opencrane/backend/observability";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _log } from "../log";
import type { LiteLlmModelDeploymentCoordinates, LiteLlmModelDeploymentTarget } from "./litellm-model-deletion.types";
import type { LiteLlmModelRegistration } from "./litellm-model-registration.types";

/** Bounds each LiteLLM inventory and deletion request made while a command retains its barrier. */
const _LITELLM_MODEL_HTTP_TIMEOUT_MS = 10_000;

/**
 * Reconciles one admitted stable deployment and removes same-name copies with matching coordinates.
 *
 * A command may find legacy deployments created before OpenCrane supplied deterministic ids. When
 * every same-name row still points at the admitted upstream model, credential, base URL, key
 * reference, and mode, this function deletes those rows by id. It preserves the admitted id when it
 * is present. A different configuration is ambiguous and fails before any deletion.
 *
 * Called by: `_RegisterLiteLlmModel` before `POST /model/new`.
 *
 * @param endpoint - LiteLLM base URL without a route suffix.
 * @param masterKey - LiteLLM administrative bearer credential.
 * @param input - Admitted registration coordinates and optional stable deployment id.
 * @param log - Logger that receives secret-free convergence outcomes.
 * @returns The admitted deployment id when it is live, or null when registration is still needed.
 * @throws When inventory is unavailable or malformed, coordinates differ, or deletion is not confirmed.
 * @see https://github.com/BerriAI/litellm/blob/main-v1.81.0-stable/litellm/proxy/proxy_server.py for the pinned model-management API.
 */
export async function _ConvergeLiteLlmModelDeployment(endpoint: string, masterKey: string, input: LiteLlmModelRegistration, log: Logger = _log): Promise<string | null>
{
	const expected = _coordinatesFromRegistration(input);
	const inventory = await _readInventory(endpoint, masterKey);
	const named = inventory.filter(deployment => deployment.publicModelName === expected.publicModelName);
	if (named.length === 0)
		return null;
	if (input.deploymentId === undefined)
	{
		if (named.length !== 1)
			throw new Error(`LiteLLM reports multiple deployments for unique model '${expected.publicModelName}'`);
		if (!_coordinatesMatch(named[0] as LiteLlmModelDeploymentTarget, expected))
			throw new Error(`LiteLLM deployment '${expected.publicModelName}' does not match the admitted model configuration`);
		return (named[0] as LiteLlmModelDeploymentTarget).deploymentId;
	}
	if (named.some(deployment => !_coordinatesMatch(deployment, expected)))
		throw new Error(`LiteLLM deployment '${expected.publicModelName}' does not match the admitted model configuration`);
	const stable = named.filter(deployment => deployment.deploymentId === input.deploymentId);
	if (stable.length > 1)
		throw new Error(`LiteLLM reports the admitted deployment id more than once for model '${expected.publicModelName}'`);
	const duplicates = named.filter(deployment => deployment.deploymentId !== input.deploymentId);
	if (stable.length === 1 && duplicates.length === 0)
		return input.deploymentId;
	for (const duplicate of duplicates)
	{
		await _deleteExactDeployment(endpoint, masterKey, duplicate, log);
	}
	const converged = await _readInventory(endpoint, masterKey);
	const remaining = converged.filter(deployment => deployment.publicModelName === expected.publicModelName);
	if (stable.length === 0)
	{
		if (remaining.length !== 0)
			throw new Error(`LiteLLM did not remove every legacy deployment for model '${expected.publicModelName}'`);
		return null;
	}
	if (remaining.length !== 1 || remaining[0]?.deploymentId !== input.deploymentId || !_coordinatesMatch(remaining[0], expected))
		throw new Error(`LiteLLM did not preserve the admitted deployment for model '${expected.publicModelName}'`);
	if (duplicates.length > 0)
		log.info({ publicModelName: expected.publicModelName, litellmModelId: input.deploymentId, deletedDeploymentCount: duplicates.length }, "litellm model duplicates removed");
	return input.deploymentId;
}

/**
 * Removes every deployment admitted for one credential before that credential can be deleted.
 *
 * The command supplies the closed target list. Live rows may include legacy same-name copies, but
 * each copy must match one target on every non-secret coordinate before its exact id is deleted.
 * Any unrecognised row that uses the credential, or any conflicting row under a target name, stops
 * the operation and leaves the caller's durable barrier in place.
 *
 * Called by: the Delete-BYOK provider effect handler.
 *
 * @param targets - Deployment ids and coordinates frozen when the delete command was admitted.
 * @param credentialName - Credential whose live model references must be empty before removal.
 * @param log - Logger that receives secret-free deletion outcomes.
 * @throws When LiteLLM is unconfigured, inventory is ambiguous, or any exact deletion is unconfirmed.
 * @see https://github.com/BerriAI/litellm/blob/main-v1.81.0-stable/litellm/proxy/proxy_server.py for the pinned model-management API.
 */
export async function _RetireLiteLlmModelDeployments(targets: readonly LiteLlmModelDeploymentTarget[], credentialName: string, log: Logger = _log): Promise<void>
{
	const endpoint = process.env.LITELLM_ENDPOINT?.trim() ?? "";
	const masterKey = process.env.LITELLM_MASTER_KEY?.trim() ?? "";
	if (!endpoint || !masterKey)
		throw new Error("LiteLLM endpoint and master key are required to retire registered provider models");
	_requireUniqueTargets(targets);
	const inventory = await _readInventory(endpoint, masterKey);
	const targetNames = new Set(targets.map(target => target.publicModelName));
	const relevant = inventory.filter(deployment => deployment.litellmCredentialName === credentialName || targetNames.has(deployment.publicModelName));
	for (const deployment of relevant)
	{
		const matches = targets.filter(target => _coordinatesMatch(deployment, target));
		if (matches.length !== 1)
			throw new Error(`LiteLLM deployment '${deployment.deploymentId}' is not admitted for provider retirement`);
	}
	for (const deployment of relevant)
	{
		await _deleteExactDeployment(endpoint, masterKey, deployment, log);
	}
	const remaining = (await _readInventory(endpoint, masterKey)).filter(deployment => deployment.litellmCredentialName === credentialName || targetNames.has(deployment.publicModelName));
	if (remaining.length !== 0)
		throw new Error(`LiteLLM retained ${remaining.length} deployment(s) after provider model retirement`);
	log.info({ credentialName, deletedDeploymentCount: relevant.length }, "litellm provider models retired");
}

/** Reads the live inventory through one traced, secret-free request. */
async function _readInventory(endpoint: string, masterKey: string): Promise<readonly LiteLlmModelDeploymentTarget[]>
{
	return ___DoWithTrace(
		"litellm.model.inventory",
		{},
		async function _Read(): Promise<readonly LiteLlmModelDeploymentTarget[]>
		{
			const response = await fetch(`${endpoint}/model/info`, { headers: { Authorization: `Bearer ${masterKey}` }, signal: AbortSignal.timeout(_LITELLM_MODEL_HTTP_TIMEOUT_MS) });
			if (!response.ok)
				throw new Error(`LiteLLM model inventory returned HTTP ${response.status}`);
			return ___ParseAndValidateJson(await response.text(), "LiteLLM model inventory response", _parseInventory);
		},
	);
}

/** Deletes one id only after a fresh inventory read proves that its coordinates still match. */
async function _deleteExactDeployment(endpoint: string, masterKey: string, target: LiteLlmModelDeploymentTarget, log: Logger): Promise<void>
{
	const before = (await _readInventory(endpoint, masterKey)).filter(deployment => deployment.deploymentId === target.deploymentId);
	if (before.length === 0)
		return;
	if (before.length !== 1 || !_coordinatesMatch(before[0] as LiteLlmModelDeploymentTarget, target))
		throw new Error(`LiteLLM deployment '${target.deploymentId}' changed before deletion`);
	await ___DoWithTrace(
		"litellm.model.delete",
		{ publicModelName: target.publicModelName, litellmModelId: target.deploymentId },
		async function _Delete(): Promise<void>
		{
			const response = await fetch(`${endpoint}/model/delete`, {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: `Bearer ${masterKey}` },
				body: JSON.stringify({ id: target.deploymentId }),
				signal: AbortSignal.timeout(_LITELLM_MODEL_HTTP_TIMEOUT_MS),
			});
			if (!response.ok)
				throw new Error(`LiteLLM model deletion returned HTTP ${response.status}`);
		},
	);
	const after = await _readInventory(endpoint, masterKey);
	if (after.some(deployment => deployment.deploymentId === target.deploymentId))
		throw new Error(`LiteLLM did not remove deployment '${target.deploymentId}'`);
	log.info({ publicModelName: target.publicModelName, litellmModelId: target.deploymentId }, "litellm model deployment removed");
}

/** Converts admitted registration inputs into the coordinates LiteLLM must report back. */
function _coordinatesFromRegistration(input: LiteLlmModelRegistration): LiteLlmModelDeploymentCoordinates
{
	const apiKeyReference = input.litellmCredentialName || !input.apiKeyEnvRef ? null : `os.environ/${input.apiKeyEnvRef}`;
	return { publicModelName: input.publicModelName, upstreamModel: input.upstreamModel, apiBase: input.apiBase ?? null, apiKeyReference, litellmCredentialName: input.litellmCredentialName ?? null, mode: input.mode ?? "chat" };
}

/** Compares every non-secret routing coordinate while deliberately ignoring deployment identity. */
function _coordinatesMatch(actual: LiteLlmModelDeploymentCoordinates, expected: LiteLlmModelDeploymentCoordinates): boolean
{
	return actual.publicModelName === expected.publicModelName
		&& actual.upstreamModel === expected.upstreamModel
		&& actual.apiBase === expected.apiBase
		&& actual.apiKeyReference === expected.apiKeyReference
		&& actual.litellmCredentialName === expected.litellmCredentialName
		&& actual.mode === expected.mode;
}

/** Validates the inventory fields that determine whether an exact id may be deleted. */
function _parseInventory(value: unknown): readonly LiteLlmModelDeploymentTarget[]
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("LiteLLM model inventory must be an object");
	const data = (value as Record<string, unknown>)["data"];
	if (!Array.isArray(data))
		throw new Error("LiteLLM model inventory data must be an array");
	const deployments: LiteLlmModelDeploymentTarget[] = [];
	for (const entry of data)
	{
		if (typeof entry !== "object" || entry === null || Array.isArray(entry))
			throw new Error("LiteLLM model inventory entry must be an object");
		const row = entry as Record<string, unknown>;
		if (row["model_name"] === undefined)
			throw new Error("LiteLLM model inventory entry must name its public model");
		const publicModelName = _requiredString(row["model_name"], "name");
		const params = _requiredObject(row["litellm_params"], "litellm_params");
		const modelInfo = _requiredObject(row["model_info"], "model_info");
		const mode = modelInfo["mode"] ?? "chat";
		if (mode !== "chat" && mode !== "embedding")
			throw new Error("LiteLLM model inventory mode must be chat or embedding");
		deployments.push({
			deploymentId: _requiredString(modelInfo["id"], "id"),
			publicModelName,
			upstreamModel: _requiredString(params["model"], "upstream model"),
			apiBase: _optionalString(params["api_base"], "api base"),
			apiKeyReference: _optionalString(params["api_key"], "api key reference"),
			litellmCredentialName: _optionalString(params["litellm_credential_name"], "credential name"),
			mode,
		});
	}
	return deployments;
}

/** Reads one required non-empty string from a LiteLLM inventory entry. */
function _requiredString(value: unknown, field: string): string
{
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`LiteLLM model inventory ${field} must be a non-empty string`);
	return value;
}

/** Reads one optional string and converts absence to null. */
function _optionalString(value: unknown, field: string): string | null
{
	if (value === undefined || value === null)
		return null;
	if (typeof value !== "string")
		throw new Error(`LiteLLM model inventory ${field} must be a string`);
	return value;
}

/** Reads one required object from a LiteLLM inventory entry. */
function _requiredObject(value: unknown, field: string): Record<string, unknown>
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`LiteLLM model inventory ${field} must be an object`);
	return value as Record<string, unknown>;
}

/** Refuses a command payload that repeats an id or gives one name conflicting target coordinates. */
function _requireUniqueTargets(targets: readonly LiteLlmModelDeploymentTarget[]): void
{
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const target of targets)
	{
		if (target.deploymentId.length === 0 || ids.has(target.deploymentId))
			throw new Error("Provider retirement contains a duplicate or empty LiteLLM deployment id");
		if (target.publicModelName.length === 0 || names.has(target.publicModelName))
			throw new Error("Provider retirement contains duplicate or empty LiteLLM model names");
		ids.add(target.deploymentId);
		names.add(target.publicModelName);
	}
}
