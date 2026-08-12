import { createHash } from "node:crypto";

import type { AttemptModelKeyIssuer } from "./attempt-model-key.types.js";
import type { ClaimedAttemptWithMintInputs, RunAttemptCredentialInput, RunAttemptCredentialMintInputs } from "./run-dispatch-persistence.types.js";
import { RunDispatchResultStatuses, type ClaimNextRunAttemptResult } from "./run-dispatch.types.js";

/** Derive the model-key request from the immutable snapshot and exact claim generation. */
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
	};
}

/** Mints the short-lived model key, only after the claim transaction has committed and released its database locks. */
export async function _MintRunAttemptCredentials(claimed: ClaimedAttemptWithMintInputs, issueAttemptModelKey: AttemptModelKeyIssuer): Promise<ClaimNextRunAttemptResult>
{
	const minted = await issueAttemptModelKey({ keyAlias: claimed.keyAlias, modelAlias: claimed.modelAlias, siloId: claimed.attempt.siloId, maxBudgetUsd: claimed.maxBudgetUsd, expirySeconds: claimed.expirySeconds });
	if (typeof minted.key !== "string" || minted.key.length === 0) throw new Error("attempt model key issuer returned no key");
	return { status: RunDispatchResultStatuses.Claimed, claim: { lease: claimed.lease, attempt: { ...claimed.attempt, litellmKey: minted.key } } };
}

/** Reads the one model alias the snapshot's model route pins, or null when it is missing or malformed. */
function _SnapshotModelAlias(modelRoute: unknown): string | null
{
	if (!modelRoute || typeof modelRoute !== "object" || Array.isArray(modelRoute)) return null;
	const route = modelRoute as Record<string, unknown>;
	const publicModelName = typeof route["publicModelName"] === "string" ? route["publicModelName"] : "";
	const alias = typeof route["alias"] === "string" ? route["alias"] : publicModelName;
	return alias.trim().length > 0 && alias.length <= 128 ? alias : null;
}

/** Converts the snapshot's budget from micro-dollars to US dollars, or null when it is missing or not positive. */
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

/** Bound the minted key lifetime to whole seconds within the issuer's 24-hour ceiling. */
function _AttemptKeyExpirySeconds(assignmentTtlMilliseconds: number): number
{
	return Math.min(Math.floor(assignmentTtlMilliseconds / 1_000), 86_400);
}
