import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";

import type { ExternalActionProviderOutcome, ExternalActionRecoveryStrategy, PreparedExternalActionAdapter } from "./external-action-worker.types";

/** Return the provider idempotency key saved at admission, throwing when there is none. */
function _recoveryKey(invocation: ToolInvocationRecord): string
{
	if (invocation.recoveryKey === null) throw new Error("external action recovery key is unavailable");
	return invocation.recoveryKey;
}

/** Retries by sending again with the saved idempotency key, so the provider treats the repeats as one call. */
class _ProviderIdempotencyStrategy implements ExternalActionRecoveryStrategy
{
	/** Send the request with the saved key, so sending it again after an unclear result still counts as one call. */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		if (claim.kind !== ExternalActionClaimKinds.Dispatch || invocation.state !== ToolInvocationStates.Claimed) throw new Error("idempotency strategy requires a dispatch claim");
		return adapter.dispatch(_recoveryKey(invocation), invocation, claim);
	}
}

/** Dispatches once, then uses provider readback for every ambiguous outcome. */
class _ProviderReconciliationStrategy implements ExternalActionRecoveryStrategy
{
	/** Send the request for a Dispatch claim; read the result back for a Reconcile claim. */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		const recoveryKey = _recoveryKey(invocation);
		if (claim.kind === ExternalActionClaimKinds.Dispatch) return adapter.dispatch(recoveryKey, invocation, claim);
		if (claim.kind === ExternalActionClaimKinds.Reconcile) return adapter.reconcile(recoveryKey, invocation, claim);
		throw new Error("reconciliation strategy received an unsupported claim");
	}
}

/** Executes once and never retries or reads back after an uncertain provider outcome. */
class _ManualRecoveryStrategy implements ExternalActionRecoveryStrategy
{
	/** Permit only the first fenced dispatch; manual recovery has no automatic second operation. */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		if (claim.kind !== ExternalActionClaimKinds.Dispatch) throw new Error("manual recovery cannot reconcile automatically");
		return adapter.dispatch(null, invocation, claim);
	}
}

/** Stateless provider-idempotency strategy shared by every worker pass. */
const _PROVIDER_IDEMPOTENCY_STRATEGY = new _ProviderIdempotencyStrategy();
/** Stateless provider-readback strategy shared by every worker pass. */
const _PROVIDER_RECONCILIATION_STRATEGY = new _ProviderReconciliationStrategy();
/** Stateless manual-recovery strategy shared by every worker pass. */
const _MANUAL_RECOVERY_STRATEGY = new _ManualRecoveryStrategy();

/**
 * Return the strategy for the recovery mode fixed when the invocation was admitted.
 *
 * Called by: `_execute` in external-action-worker.ts, on every claimed pass.
 *
 * @param mode - The mode saved on the invocation row, never one derived from the adapter.
 * @returns The strategy for that mode. Anything other than provider-idempotency or reconciliation
 * gets manual recovery, which will never make a second provider call on its own.
 * @see ExternalActionRecoveryStrategy
 */
export function _ExternalActionRecoveryStrategy(mode: ExternalActionRecoveryModes): ExternalActionRecoveryStrategy
{
	if (mode === ExternalActionRecoveryModes.ProviderIdempotency) return _PROVIDER_IDEMPOTENCY_STRATEGY;
	if (mode === ExternalActionRecoveryModes.Reconciliation) return _PROVIDER_RECONCILIATION_STRATEGY;
	return _MANUAL_RECOVERY_STRATEGY;
}
