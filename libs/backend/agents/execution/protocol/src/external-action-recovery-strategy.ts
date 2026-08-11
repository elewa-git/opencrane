import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";

import type { ExternalActionProviderOutcome, ExternalActionRecoveryStrategy, PreparedExternalActionAdapter } from "./external-action-worker.types.js";

/** Require the provider idempotency key frozen at admission. */
function _recoveryKey(invocation: ToolInvocationRecord): string
{
	if (invocation.recoveryKey === null) throw new Error("external action recovery key is unavailable");
	return invocation.recoveryKey;
}

/** Repeats dispatch only through a provider adapter bound to the exact frozen idempotency key. */
class _ProviderIdempotencyStrategy implements ExternalActionRecoveryStrategy
{
	/** Dispatch the exact request; the provider key makes an ambiguous repeat one logical effect. */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		if (claim.kind !== ExternalActionClaimKinds.Dispatch || invocation.state !== ToolInvocationStates.Claimed) throw new Error("idempotency strategy requires a dispatch claim");
		return adapter.dispatch(_recoveryKey(invocation));
	}
}

/** Dispatches once, then uses provider readback for every ambiguous outcome. */
class _ProviderReconciliationStrategy implements ExternalActionRecoveryStrategy
{
	/** Select dispatch for Ready work and non-mutating readback for a reconciliation claim. */
	execute(adapter: PreparedExternalActionAdapter, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		const recoveryKey = _recoveryKey(invocation);
		if (claim.kind === ExternalActionClaimKinds.Dispatch) return adapter.dispatch(recoveryKey);
		if (claim.kind === ExternalActionClaimKinds.Reconcile) return adapter.reconcile(recoveryKey);
		throw new Error("reconciliation strategy received an unsupported claim");
	}
}

/** Executes once and never retries or reads back after an uncertain provider outcome. */
class _ManualRecoveryStrategy implements ExternalActionRecoveryStrategy
{
	/** Permit only the first fenced dispatch; manual recovery has no automatic second operation. */
	execute(adapter: PreparedExternalActionAdapter, _invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		if (claim.kind !== ExternalActionClaimKinds.Dispatch) throw new Error("manual recovery cannot reconcile automatically");
		return adapter.dispatch(null);
	}
}

/** Stateless provider-idempotency strategy shared by every worker pass. */
const _PROVIDER_IDEMPOTENCY_STRATEGY = new _ProviderIdempotencyStrategy();
/** Stateless provider-readback strategy shared by every worker pass. */
const _PROVIDER_RECONCILIATION_STRATEGY = new _ProviderReconciliationStrategy();
/** Stateless manual-recovery strategy shared by every worker pass. */
const _MANUAL_RECOVERY_STRATEGY = new _ManualRecoveryStrategy();

/** Select the explicit strategy frozen by trusted admission before provider dispatch. */
export function _ExternalActionRecoveryStrategy(mode: ExternalActionRecoveryModes): ExternalActionRecoveryStrategy
{
	if (mode === ExternalActionRecoveryModes.ProviderIdempotency) return _PROVIDER_IDEMPOTENCY_STRATEGY;
	if (mode === ExternalActionRecoveryModes.Reconciliation) return _PROVIDER_RECONCILIATION_STRATEGY;
	return _MANUAL_RECOVERY_STRATEGY;
}
