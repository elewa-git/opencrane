import type { CapabilityProofExpectation } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import { __NormalizeDpopTargetUri, __VerifyCapabilityProof } from "./capability-proof";
import { __DigestCanonicalJson } from "./canonical-json-digest";
import type { CapabilityActionExecutor, CapabilityActionIntent, CapabilityActionReceipt, CapabilityActionReceiptRepository, ExecuteCapabilityActionCommand, ExecuteCapabilityActionResult } from "./runtime-proof.types";

/** Digests the verified capability together with the observed HTTP method and target URI; the proof's issue time is deliberately left out. */
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

/**
 * Run one signed action at most once, whatever crashes in between.
 *
 * The order is the safety property: verify the proof, commit a reservation keyed by the proof's
 * `jti`, then perform the external call outside any transaction, then record the outcome. A crash
 * after the reservation leaves a row that blocks every retry, so the action cannot run twice.
 *
 * An action that throws is recorded as failed and reported as `action_execution_failed`. If we
 * cannot record the outcome at all, the result is `action_execution_ambiguous` — the action may
 * have taken effect, so a caller must surface it as unresolved and must not retry.
 *
 * Called by: no caller in this repo yet — only its own tests in
 * ./__tests__/runtime-proof.test.ts.
 * @param repository - Reservation and receipt store; see {@link CapabilityActionReceiptRepository}.
 * @param command - The compact proof, the trusted facts to verify it against, and the replay mode.
 * @param executor - The external action; called at most once, and never inside a transaction.
 * @returns `executed` on first success, `replayed` when an identical idempotent request already
 *   succeeded, or `denied` with a reason. See {@link ExecuteCapabilityActionResult}.
 */
export async function __ExecuteCapabilityAction<TResult>(repository: CapabilityActionReceiptRepository, command: ExecuteCapabilityActionCommand, executor: CapabilityActionExecutor<TResult>): Promise<ExecuteCapabilityActionResult<TResult>>
{
	// 1. Check the replay mode and verify the proof signature, so nothing but a real proof reaches replay state.
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
