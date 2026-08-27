import { createHash } from "node:crypto";

import type { RunAttemptCredentialInput, RunAttemptCredentialMintInputs } from "./run-attempt-credential-minting.types";

/** Derive the model-key request from the immutable snapshot and exact claim generation. */
export function _BuildRunAttemptCredentialMintInputs(input: RunAttemptCredentialInput): RunAttemptCredentialMintInputs | null
{
	const modelAlias = _SnapshotModelAlias(input.modelRoute);
	const maxBudgetUsd = _SnapshotMaxBudgetUsd(input.budgetPolicy);
	if (modelAlias === null || maxBudgetUsd === null) return null;
	return {
		keyAlias: __BuildRunAttemptKeyAlias(input.runId, input.attempt, input.siloId),
		modelAlias,
		maxBudgetUsd,
		expirySeconds: _AttemptKeyExpirySeconds(input.assignmentTtlMilliseconds),
	};
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
export function __BuildRunAttemptKeyAlias(runId: string, attempt: number, siloId: string): string
{
	const canonical = JSON.stringify(["opencrane-attempt-litellm-key-alias-v2", runId, attempt, siloId]);
	return `attempt-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/** Bound the minted key lifetime to whole seconds within the issuer's 24-hour ceiling. */
function _AttemptKeyExpirySeconds(assignmentTtlMilliseconds: number): number
{
	return Math.min(Math.floor(assignmentTtlMilliseconds / 1_000), 86_400);
}
