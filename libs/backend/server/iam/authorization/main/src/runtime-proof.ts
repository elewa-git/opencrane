import type { CapabilityProofExpectation } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import { __ComputeEs256JwkThumbprint, __NormalizeDpopTargetUri, __VerifyCapabilityProof } from "./capability-proof.js";
import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import type { CapabilityActionExecutor, CapabilityActionIntent, CapabilityActionReceipt, CapabilityActionReceiptRepository, ConsumeRuntimeBootstrapResult, ExecuteCapabilityActionCommand, ExecuteCapabilityActionResult, RuntimeBootstrapClaim, RuntimeBootstrapExpectation, RuntimeBootstrapFailureReason, RuntimeBootstrapRepository } from "./runtime-proof.types.js";

/** Sole audience accepted for projected workload identity tokens. */
const _PROJECTED_TOKEN_AUDIENCE = "opencrane";

/** Returns whether a value is one of the two accepted controller workload kinds. */
function _isWorkloadKind(value: string): value is "job" | "deployment"
{
	return value === "job" || value === "deployment";
}

/** Returns whether a value is a canonical unpadded RFC 7638 SHA-256 thumbprint. */
function _isProofKeyThumbprint(value: string): boolean
{
	if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false;
	const decoded = Buffer.from(value, "base64url");
	return decoded.length === 32 && decoded.toString("base64url") === value;
}

/** Validates every immutable workload and run-attempt bootstrap binding. */
function _validateBootstrap(claim: RuntimeBootstrapClaim, expectation: RuntimeBootstrapExpectation): RuntimeBootstrapFailureReason | null
{
	// 1. Validate identifiers, counters, and trusted time before comparing authority facts.
	const requiredIdentifiers = [claim.bootstrapId, claim.siloId, claim.audience, claim.subjectId, claim.serviceAccountName, claim.namespace, claim.workloadUid, claim.podUid, claim.runId, claim.agentServiceId, claim.agentRevisionId, expectation.siloId, expectation.audience, expectation.subjectId, expectation.serviceAccountName, expectation.namespace, expectation.workloadUid, expectation.podUid, expectation.runId, expectation.agentServiceId, expectation.agentRevisionId];
	if (requiredIdentifiers.some(value => !value.trim()) || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1 || !Number.isSafeInteger(expectation.attempt) || expectation.attempt < 1 || !Number.isSafeInteger(expectation.nowEpochMs) || expectation.nowEpochMs < 0) return "invalid_bootstrap";
	if (!_isWorkloadKind(claim.workloadKind) || !_isWorkloadKind(expectation.workloadKind)) return "invalid_workload_kind";
	if (!_isProofKeyThumbprint(claim.proofKeyThumbprint)) return "invalid_proof_key";

	// 2. Derive the thumbprint from the proposed public key before accepting the caller's value.
	let computedProofKeyThumbprint: string;
	try
	{
		computedProofKeyThumbprint = __ComputeEs256JwkThumbprint(claim.proofPublicJwk);
	}
	catch
	{
		return "invalid_proof_key";
	}
	if (computedProofKeyThumbprint !== claim.proofKeyThumbprint) return "proof_key_mismatch";

	// 3. Compare every assignment and run-attempt field, then enforce the hard expiry.
	if (claim.siloId !== expectation.siloId) return "silo_mismatch";
	if (claim.audience !== _PROJECTED_TOKEN_AUDIENCE || expectation.audience !== _PROJECTED_TOKEN_AUDIENCE) return "projected_token_audience_mismatch";
	if (claim.subjectId !== expectation.subjectId) return "subject_mismatch";
	if (claim.serviceAccountName !== expectation.serviceAccountName) return "service_account_mismatch";
	if (claim.namespace !== expectation.namespace) return "namespace_mismatch";
	if (claim.workloadKind !== expectation.workloadKind) return "workload_kind_mismatch";
	if (claim.workloadUid !== expectation.workloadUid) return "workload_uid_mismatch";
	if (claim.podUid !== expectation.podUid) return "pod_mismatch";
	if (claim.agentServiceId !== expectation.agentServiceId) return "agent_service_mismatch";
	if (claim.runId !== expectation.runId) return "run_mismatch";
	if (claim.attempt !== expectation.attempt) return "attempt_mismatch";
	if (claim.agentRevisionId !== expectation.agentRevisionId) return "revision_mismatch";
	if (!Number.isSafeInteger(expectation.nowEpochMs) || !Number.isSafeInteger(claim.expiresAtEpochMs) || expectation.nowEpochMs >= claim.expiresAtEpochMs) return "expired";
	return null;
}

/** Digests the exact verified action authority and observed request without proof issuance time. */
function _requestFingerprint(expectation: CapabilityProofExpectation): string
{
	const capability = expectation.capability;
	return __DigestCanonicalJson({
		jti: capability.jti,
		audience: capability.audience,
		siloId: capability.siloId,
		subjectId: capability.subjectId,
		serviceAccountName: capability.serviceAccountName,
		namespace: capability.namespace,
		workloadKind: capability.workloadKind,
		workloadUid: capability.workloadUid,
		podUid: capability.podUid,
		agentServiceId: capability.agentServiceId,
		agentRevisionId: capability.agentRevisionId,
		runId: capability.runId,
		attempt: capability.attempt,
		capability: capability.capability,
		resource: capability.resource,
		action: capability.action,
		argumentsDigest: capability.argumentsDigest,
		proofKeyThumbprint: capability.proofKeyThumbprint,
		effectiveAuthorizationDigest: capability.effectiveAuthorizationDigest,
		notBefore: capability.notBefore,
		expiresAt: capability.expiresAt,
		httpMethod: expectation.httpMethod.toUpperCase(),
		targetUri: __NormalizeDpopTargetUri(expectation.targetUri),
	} as unknown as JsonValue);
}

/** Returns whether a repository receipt remains bound to the exact verified action intent. */
function _receiptMatchesIntent<TResult>(receipt: CapabilityActionReceipt<TResult>, intent: CapabilityActionIntent): boolean
{
	return receipt.jti === intent.jti
		&& receipt.requestFingerprint === intent.requestFingerprint
		&& receipt.replayMode === intent.replayMode;
}

/** Validates and atomically consumes a one-time runtime bootstrap claim. */
export async function __ConsumeRuntimeBootstrap(repository: RuntimeBootstrapRepository, claim: RuntimeBootstrapClaim, expectation: RuntimeBootstrapExpectation): Promise<ConsumeRuntimeBootstrapResult>
{
	const failure = _validateBootstrap(claim, expectation);
	if (failure !== null) return { outcome: "denied", reason: failure };
	const consumption = await repository.consumeAndBindProofKeyAtomically(claim);
	if (consumption.status === "consumed") return { outcome: "consumed", receiptId: consumption.receiptId };
	if (consumption.status === "already_consumed") return { outcome: "denied", reason: "bootstrap_replay" };
	return { outcome: "denied", reason: "bootstrap_conflict" };
}

/**
 * Verifies a compact ES256 proof, reserves its JTI durably, then performs external I/O.
 * @param repository - Durable capability receipt and replay authority.
 * @param command - Compact proof, trusted expectation, and explicit replay mode.
 * @param executor - Deferred action invoked only for the first accepted JTI.
 * @returns First execution, allowed idempotent replay, or fail-closed denial.
 */
export async function __ExecuteCapabilityAction<TResult>(repository: CapabilityActionReceiptRepository, command: ExecuteCapabilityActionCommand, executor: CapabilityActionExecutor<TResult>): Promise<ExecuteCapabilityActionResult<TResult>>
{
	// 1. Cryptographic and semantic verification prevents non-proof inputs from reaching replay state.
	if (command.replayMode !== "one_shot" && command.replayMode !== "idempotent") return { outcome: "denied", reason: "invalid_replay_mode" };
	const verification = __VerifyCapabilityProof(command.compactProof, command.expectation);
	if (!verification.valid) return { outcome: "denied", reason: verification.reason };

	// 2. Reserve the verified JTI before I/O so crashes leave durable evidence that blocks retries.
	const intent = {
		jti: verification.claims.jti,
		requestFingerprint: _requestFingerprint(command.expectation),
		replayMode: command.replayMode,
		audience: command.expectation.capability.audience,
		siloId: command.expectation.capability.siloId,
		subjectId: command.expectation.capability.subjectId,
		serviceAccountName: command.expectation.capability.serviceAccountName,
		namespace: command.expectation.capability.namespace,
		workloadKind: command.expectation.capability.workloadKind,
		workloadUid: command.expectation.capability.workloadUid,
		podUid: command.expectation.capability.podUid,
		runId: command.expectation.capability.runId,
		attempt: command.expectation.capability.attempt,
		agentServiceId: command.expectation.capability.agentServiceId,
		agentRevisionId: command.expectation.capability.agentRevisionId,
		proofKeyThumbprint: command.expectation.capability.proofKeyThumbprint,
		catalogId: command.expectation.capability.capability.catalog.catalogId,
		catalogRevision: command.expectation.capability.capability.catalog.revision,
		catalogDigest: command.expectation.capability.capability.catalog.digest,
		capabilityId: command.expectation.capability.capability.capabilityId,
		effectivePolicyDigest: command.expectation.capability.effectiveAuthorizationDigest,
		resourceKind: command.expectation.capability.resource.kind,
		resourceId: command.expectation.capability.resource.id,
		action: command.expectation.capability.action,
		argumentsDigest: command.expectation.capability.argumentsDigest,
	};
	let reservation;
	try
	{
		reservation = await repository.reserve<TResult>(intent);
	}
	catch
	{
		return { outcome: "denied", reason: "action_reservation_failed" };
	}
	if (reservation.status === "existing_succeeded")
	{
		if (_receiptMatchesIntent(reservation.receipt, intent) && intent.replayMode === "idempotent") return { outcome: "replayed", receipt: reservation.receipt };
		return { outcome: "denied", reason: "jti_replay" };
	}
	if (reservation.status !== "reserved") return { outcome: "denied", reason: "jti_replay" };

	// 3. Execute outside the persistence transaction, marking thrown actions durably as failed.
	let result: TResult;
	try
	{
		result = await executor.execute();
	}
	catch
	{
		try
		{
			const failure = await repository.markFailed(reservation.reservationId, "executor_failed");
			if (failure.status === "conflict") return { outcome: "denied", reason: "action_execution_ambiguous" };
		}
		catch
		{
			return { outcome: "denied", reason: "action_execution_ambiguous" };
		}
		return { outcome: "denied", reason: "action_execution_failed" };
	}

	// 4. Complete only the exact reservation; a persistence conflict after I/O is ambiguous and never retried.
	try
	{
		const completion = await repository.markSucceeded(reservation.reservationId, result);
		if (completion.status === "conflict") return { outcome: "denied", reason: "action_execution_ambiguous" };
		if (!_receiptMatchesIntent(completion.receipt, intent)) return { outcome: "denied", reason: "action_execution_ambiguous" };
		return { outcome: "executed", receipt: completion.receipt };
	}
	catch
	{
		return { outcome: "denied", reason: "action_execution_ambiguous" };
	}
}
