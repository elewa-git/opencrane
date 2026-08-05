import { createHash } from "node:crypto";

import type { AttemptModelKeyIssuer } from "./attempt-model-key.types.js";
import type { AttemptObotKeyIssuer } from "./attempt-obot-key.types.js";
import type { ClaimedAttemptWithMintInputs, RunAttemptCredentialInput, RunAttemptCredentialMintInputs } from "./run-dispatch-persistence.types.js";
import { RunDispatchResultStatuses, type ClaimNextRunAttemptResult } from "./run-dispatch.types.js";

/** Derive credential requests from the immutable snapshot and exact claim generation. */
export function _BuildRunAttemptCredentialMintInputs(input: RunAttemptCredentialInput): RunAttemptCredentialMintInputs | null
{
	const modelAlias = _SnapshotModelAlias(input.modelRoute);
	const maxBudgetUsd = _SnapshotMaxBudgetUsd(input.budgetPolicy);
	if (modelAlias === null || maxBudgetUsd === null) return null;
	return {
		keyAlias: _AttemptKeyAlias(input.runId, input.attempt, input.siloId, input.deliveryCount),
		modelAlias,
		maxBudgetUsd,
		expirySeconds: _AttemptKeyExpirySeconds(input.assignmentTtlMilliseconds),
		obotIntegrationIds: _SnapshotIntegrationIds(input.integrationAssignments),
		obotKeyName: _AttemptObotKeyName(input.runId, input.attempt, input.siloId, input.deliveryCount),
		obotKeyExpiresAt: new Date(input.claimedAt.getTime() + input.assignmentTtlMilliseconds),
	};
}

/** Mint transient attempt credentials after the claim transaction has released every database lock. */
export async function _MintRunAttemptCredentials(claimed: ClaimedAttemptWithMintInputs, issueAttemptModelKey: AttemptModelKeyIssuer, issueAttemptObotKey: AttemptObotKeyIssuer | null): Promise<ClaimNextRunAttemptResult>
{
	const minted = await issueAttemptModelKey({ keyAlias: claimed.keyAlias, modelAlias: claimed.modelAlias, siloId: claimed.attempt.siloId, maxBudgetUsd: claimed.maxBudgetUsd, expirySeconds: claimed.expirySeconds });
	if (typeof minted.key !== "string" || minted.key.length === 0) throw new Error("attempt model key issuer returned no key");
	if (issueAttemptObotKey === null || claimed.obotIntegrationIds.length === 0)
	{
		return { status: RunDispatchResultStatuses.Claimed, claim: { lease: claimed.lease, attempt: { ...claimed.attempt, litellmKey: minted.key } } };
	}
	const mintedObot = await issueAttemptObotKey({ runId: claimed.attempt.runId, attempt: claimed.attempt.attempt, siloId: claimed.attempt.siloId, agentRevisionId: claimed.attempt.agentRevisionId, integrationIds: claimed.obotIntegrationIds, keyName: claimed.obotKeyName, expiresAt: claimed.obotKeyExpiresAt });
	if (typeof mintedObot.key !== "string" || mintedObot.key.length === 0 || typeof mintedObot.keyId !== "string" || mintedObot.keyId.length === 0) throw new Error("attempt Obot key issuer returned no key");
	return { status: RunDispatchResultStatuses.Claimed, claim: { lease: claimed.lease, attempt: { ...claimed.attempt, litellmKey: minted.key, obotKey: { key: mintedObot.key, keyId: mintedObot.keyId } } } };
}

/** Parse the integration ids frozen into the immutable snapshot's assignment JSON. */
export function _SnapshotIntegrationIds(value: unknown): readonly string[]
{
	if (!Array.isArray(value)) return [];
	const ids: string[] = [];
	for (const entry of value)
	{
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const integrationId = (entry as Record<string, unknown>)["integrationId"];
		if (typeof integrationId === "string" && integrationId.trim().length > 0) ids.push(integrationId);
	}
	return ids;
}

/** Extract the single model alias frozen into the snapshot's server-selected route. */
function _SnapshotModelAlias(modelRoute: unknown): string | null
{
	if (!modelRoute || typeof modelRoute !== "object" || Array.isArray(modelRoute)) return null;
	const route = modelRoute as Record<string, unknown>;
	const publicModelName = typeof route["publicModelName"] === "string" ? route["publicModelName"] : "";
	const alias = typeof route["alias"] === "string" ? route["alias"] : publicModelName;
	return alias.trim().length > 0 && alias.length <= 128 ? alias : null;
}

/** Derive the positive US-dollar spend ceiling from the snapshot's micro-dollar cost policy. */
function _SnapshotMaxBudgetUsd(budgetPolicy: unknown): number | null
{
	if (!budgetPolicy || typeof budgetPolicy !== "object" || Array.isArray(budgetPolicy)) return null;
	const micros = (budgetPolicy as Record<string, unknown>)["maxCostUsdMicros"];
	if (typeof micros !== "number" || !Number.isSafeInteger(micros) || micros <= 0) return null;
	return micros / 1_000_000;
}

/** Derive one attempt- and delivery-unique key alias satisfying the issuer's `attempt-<hex>` grammar. */
function _AttemptKeyAlias(runId: string, attempt: number, siloId: string, deliveryCount: number): string
{
	const canonical = JSON.stringify(["opencrane-attempt-litellm-key-alias-v1", runId, attempt, siloId, deliveryCount]);
	return `attempt-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/** Derive one attempt- and delivery-unique Obot key name for audit correlation; never a secret. */
function _AttemptObotKeyName(runId: string, attempt: number, siloId: string, deliveryCount: number): string
{
	const canonical = JSON.stringify(["opencrane-attempt-obot-key-name-v1", runId, attempt, siloId, deliveryCount]);
	return `attempt-obot-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/** Bound the minted key lifetime to whole seconds within the issuer's 24-hour ceiling. */
function _AttemptKeyExpirySeconds(assignmentTtlMilliseconds: number): number
{
	return Math.min(Math.floor(assignmentTtlMilliseconds / 1_000), 86_400);
}
