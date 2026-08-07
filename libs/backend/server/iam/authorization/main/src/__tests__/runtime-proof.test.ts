import { generateKeyPairSync, sign } from "node:crypto";
import type { ActionCapability, CapabilityProofExpectation, Es256PublicJwk } from "@opencrane/models/authorization";
import { ___CanonicalizeJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";
import { describe, expect, it } from "vitest";

import { __ComputeEs256JwkThumbprint } from "../capability-proof.js";
import { __DigestCanonicalJson } from "../canonical-json-digest.js";
import { __ConsumeRuntimeBootstrap, __ExecuteCapabilityAction } from "../runtime-proof.js";
import type { CapabilityActionExecutor, CapabilityActionFailureResult, CapabilityActionIntent, CapabilityActionReceipt, CapabilityActionReceiptRepository, CapabilityActionReservationResult, CapabilityActionSuccessResult, ExecuteCapabilityActionCommand, RuntimeBootstrapClaim, RuntimeBootstrapConsumptionResult, RuntimeBootstrapExpectation, RuntimeBootstrapRepository } from "../runtime-proof.types.js";

/** Fixed trusted NumericDate used by action-proof fixtures. */
const NOW = 1_750_000_000;

/** Ephemeral P-256 run proof key pair. */
const KEY_PAIR = generateKeyPairSync("ec", { namedCurve: "P-256" });

/** Public JWK proposed during bootstrap and embedded in action proofs. */
const PUBLIC_JWK = KEY_PAIR.publicKey.export({ format: "jwk" }) as Es256PublicJwk;

/** Verified thumbprint bound atomically during bootstrap. */
const PROOF_KEY_THUMBPRINT = __ComputeEs256JwkThumbprint(PUBLIC_JWK);

/** Creates a personal attempt Job bootstrap claim with a proposed run key. */
function _bootstrap(): RuntimeBootstrapClaim
{
	return {
		bootstrapId: "bootstrap-1",
		siloId: "silo-1",
		audience: "opencrane-agent-runtime",
		subjectId: "user-1",
		serviceAccountName: "agent-runtime",
		namespace: "silo-1-runtime",
		workloadKind: "job",
		workloadUid: "job-uid-1",
		podUid: "pod-uid-1",
		runId: "run-1",
		agentServiceId: "agent-service-1",
		attempt: 2,
		agentRevisionId: "revision-1",
		proofPublicJwk: PUBLIC_JWK,
		proofKeyThumbprint: PROOF_KEY_THUMBPRINT,
		expiresAtEpochMs: 2000,
	};
}

/** Creates assignment facts known before the runtime proposes its proof key. */
function _bootstrapExpectation(): RuntimeBootstrapExpectation
{
	return {
		siloId: "silo-1",
		audience: "opencrane-agent-runtime",
		subjectId: "user-1",
		serviceAccountName: "agent-runtime",
		namespace: "silo-1-runtime",
		workloadKind: "job",
		workloadUid: "job-uid-1",
		podUid: "pod-uid-1",
		runId: "run-1",
		agentServiceId: "agent-service-1",
		attempt: 2,
		agentRevisionId: "revision-1",
		nowEpochMs: 1000,
	};
}

/** In-memory atomic bootstrap consumption and proof-key binding port. */
class _BootstrapRepository implements RuntimeBootstrapRepository
{
	/** Claims consumed and bound by bootstrap identifier. */
	private readonly consumed = new Map<string, RuntimeBootstrapClaim>();

	/** Consumes once and records the already verified proposed run proof key. */
	async consumeAndBindProofKeyAtomically(claim: RuntimeBootstrapClaim): Promise<RuntimeBootstrapConsumptionResult>
	{
		const existing = this.consumed.get(claim.bootstrapId);
		if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(claim)) return { status: "already_consumed" };
		if (existing !== undefined) return { status: "conflict" };
		this.consumed.set(claim.bootstrapId, claim);
		return { status: "consumed", receiptId: `receipt-${claim.bootstrapId}` };
	}
}

/** Creates one complete proof-bound action capability. */
function _capability(argumentsDigest = __DigestCanonicalJson({ filename: "brief.pdf" })): ActionCapability
{
	return {
		jti: "capability-1",
		audience: "artifact-service",
		siloId: "silo-1",
		subjectId: "user-1",
		serviceAccountName: "agent-runtime",
		namespace: "silo-1-runtime",
		workloadKind: "deployment",
		workloadUid: "deployment-uid-1",
		podUid: "pod-uid-1",
		agentServiceId: "agent-service-1",
		agentRevisionId: "revision-1",
		runId: "run-1",
		attempt: 2,
		proofKeyThumbprint: PROOF_KEY_THUMBPRINT,
		capability: { catalog: { catalogId: "core", revision: 1, digest: __DigestCanonicalJson({ catalog: "core", revision: 1 }) }, capabilityId: "artifact.write" },
		resource: { kind: "artifact", id: "artifact-1" },
		action: "artifact.write",
		argumentsDigest,
		effectiveAuthorizationDigest: __DigestCanonicalJson({ grants: ["grant-1"] }),
		notBefore: NOW - 60,
		expiresAt: NOW + 60,
	};
}

/** Creates the independent trusted binding projection for one capability. */
function _expectation(capability: ActionCapability): CapabilityProofExpectation
{
	return {
		capability,
		binding: {
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
			proofKeyThumbprint: capability.proofKeyThumbprint,
			capability: capability.capability,
			resource: capability.resource,
			action: capability.action,
			argumentsDigest: capability.argumentsDigest,
			effectiveAuthorizationDigest: capability.effectiveAuthorizationDigest,
		},
		httpMethod: "POST",
		targetUri: "https://api.opencrane.test/v1/artifacts/artifact-1",
		nowEpochSeconds: NOW,
		maximumProofAgeSeconds: 5,
		clockSkewSeconds: 2,
	};
}

/** Signs a compact P1363 proof carrying every capability binding. */
function _compactProof(capability: ActionCapability): string
{
	const header: JsonValue = { typ: "dpop+jwt", alg: "ES256", jwk: PUBLIC_JWK as unknown as JsonValue };
	const claims: JsonValue = {
		aud: capability.audience,
		jti: capability.jti,
		htm: "POST",
		htu: "https://api.opencrane.test/v1/artifacts/artifact-1",
		iat: NOW,
		nbf: capability.notBefore,
		exp: capability.expiresAt,
		silo_id: capability.siloId,
		subject_id: capability.subjectId,
		service_account_name: capability.serviceAccountName,
		namespace: capability.namespace,
		workload_kind: capability.workloadKind,
		workload_uid: capability.workloadUid,
		pod_uid: capability.podUid,
		agent_service_id: capability.agentServiceId,
		agent_revision_id: capability.agentRevisionId,
		run_id: capability.runId,
		attempt: capability.attempt,
		proof_key_thumbprint: capability.proofKeyThumbprint,
		capability: capability.capability as unknown as JsonValue,
		resource: { kind: capability.resource.kind, id: capability.resource.id },
		action: capability.action,
		arguments_digest: capability.argumentsDigest,
		effective_authorization_digest: capability.effectiveAuthorizationDigest,
	};
	const protectedHeader = Buffer.from(___CanonicalizeJson(header), "utf8").toString("base64url");
	const protectedClaims = Buffer.from(___CanonicalizeJson(claims), "utf8").toString("base64url");
	const signature = sign("sha256", Buffer.from(`${protectedHeader}.${protectedClaims}`, "ascii"), { key: KEY_PAIR.privateKey, dsaEncoding: "ieee-p1363" });
	return `${protectedHeader}.${protectedClaims}.${signature.toString("base64url")}`;
}

/** Creates one executable capability action command. */
function _command(replayMode: "one_shot" | "idempotent", capability = _capability()): ExecuteCapabilityActionCommand
{
	return { compactProof: _compactProof(capability), expectation: _expectation(capability), replayMode };
}

/** In-memory capability-JTI receipt authority with durable state transitions. */
class _ReceiptRepository implements CapabilityActionReceiptRepository
{
	/** Durable records indexed by capability JTI. */
	private readonly records = new Map<string, { reservationId: string; intent: CapabilityActionIntent; state: "reserved" | "succeeded" | "failed"; result?: unknown }>();
	/** Capability JTI indexed by opaque reservation identifier. */
	private readonly reservationJtis = new Map<string, string>();
	/** Whether successful completion should simulate unavailable persistence. */
	failSuccessfulCompletion = false;
	/** Whether failure completion should simulate unavailable persistence. */
	failFailureCompletion = false;
	/** Whether reservation should simulate unavailable persistence before mutation. */
	failReservation = false;

	/** Atomically creates Reserved or returns the existing durable JTI state. */
	async reserve<TResult>(intent: CapabilityActionIntent): Promise<CapabilityActionReservationResult<TResult>>
	{
		if (this.failReservation) throw new Error("reservation unavailable");
		const existing = this.records.get(intent.jti);
		if (existing !== undefined)
		{
			if (existing.state === "reserved") return { status: "existing_reserved" };
			if (existing.state === "failed") return { status: "existing_failed" };
			return {
				status: "existing_succeeded",
				receipt: { ...existing.intent, result: existing.result as TResult },
			};
		}

		const reservationId = `reservation-${this.records.size + 1}`;
		this.records.set(intent.jti, { reservationId, intent, state: "reserved" });
		this.reservationJtis.set(reservationId, intent.jti);
		return { status: "reserved", reservationId };
	}

	/** Atomically marks the exact Reserved record Succeeded. */
	async markSucceeded<TResult>(reservationId: string, result: TResult): Promise<CapabilityActionSuccessResult<TResult>>
	{
		if (this.failSuccessfulCompletion) throw new Error("completion unavailable");
		const jti = this.reservationJtis.get(reservationId);
		const record = jti === undefined ? undefined : this.records.get(jti);
		if (record === undefined || record.reservationId !== reservationId || record.state !== "reserved") return { status: "conflict" };
		record.state = "succeeded";
		record.result = result;
		return { status: "succeeded", receipt: { ...record.intent, result } };
	}

	/** Atomically marks the exact Reserved record Failed. */
	async markFailed(reservationId: string, _failureCode: string): Promise<CapabilityActionFailureResult>
	{
		if (this.failFailureCompletion) throw new Error("failure completion unavailable");
		const jti = this.reservationJtis.get(reservationId);
		const record = jti === undefined ? undefined : this.records.get(jti);
		if (record === undefined || record.reservationId !== reservationId || record.state !== "reserved") return { status: "conflict" };
		record.state = "failed";
		return { status: "failed" };
	}
}

/** Counting action executor that exposes duplicate execution. */
class _Executor implements CapabilityActionExecutor<{ value: string }>
{
	/** Number of times the underlying action executed. */
	count = 0;

	/** Produces one stable action result. */
	async execute(): Promise<{ value: string }>
	{
		this.count += 1;
		return { value: "canonical-result" };
	}
}

/** Action executor that records its attempt before throwing. */
class _ThrowingExecutor implements CapabilityActionExecutor<{ value: string }>
{
	/** Number of times the failing action was attempted. */
	count = 0;

	/** Throws after recording the single external action attempt. */
	async execute(): Promise<{ value: string }>
	{
		this.count += 1;
		throw new Error("external action failed");
	}
}

describe("runtime bootstrap and capability replay", function _suite()
{
	it("fails closed for every assignment, workload, run, revision, proof-key, and expiry mismatch", async function _bootstrapMismatchMatrix()
	{
		const cases: Array<[Partial<RuntimeBootstrapClaim>, string]> = [
			[{ siloId: "silo-other" }, "silo_mismatch"],
			[{ audience: "artifact-service" as RuntimeBootstrapClaim["audience"] }, "projected_token_audience_mismatch"],
			[{ subjectId: "user-other" }, "subject_mismatch"],
			[{ serviceAccountName: "wrong-ksa" }, "service_account_mismatch"],
			[{ namespace: "wrong-namespace" }, "namespace_mismatch"],
			[{ workloadKind: "deployment" }, "workload_kind_mismatch"],
			[{ workloadUid: "wrong-workload-uid" }, "workload_uid_mismatch"],
			[{ podUid: "wrong-pod" }, "pod_mismatch"],
			[{ runId: "run-other" }, "run_mismatch"],
			[{ agentServiceId: "agent-service-other" }, "agent_service_mismatch"],
			[{ attempt: 3 }, "attempt_mismatch"],
			[{ agentRevisionId: "revision-other" }, "revision_mismatch"],
			[{ proofKeyThumbprint: Buffer.alloc(32, 2).toString("base64url") }, "proof_key_mismatch"],
			[{ proofPublicJwk: { ...PUBLIC_JWK, x: "AA" } }, "invalid_proof_key"],
			[{ expiresAtEpochMs: 1000 }, "expired"],
		];
		for (const [change, reason] of cases)
		{
			expect(await __ConsumeRuntimeBootstrap(new _BootstrapRepository(), { ..._bootstrap(), ...change }, _bootstrapExpectation())).toEqual({ outcome: "denied", reason });
		}
	});

	it("atomically binds a Job proof key once and rejects bootstrap replay", async function _bootstrapReplay()
	{
		const repository = new _BootstrapRepository();
		const first = await __ConsumeRuntimeBootstrap(repository, _bootstrap(), _bootstrapExpectation());
		const second = await __ConsumeRuntimeBootstrap(repository, _bootstrap(), _bootstrapExpectation());

		expect(first).toEqual({ outcome: "consumed", receiptId: "receipt-bootstrap-1" });
		expect(second).toEqual({ outcome: "denied", reason: "bootstrap_replay" });
	});

	it("rejects matching non-control-plane bootstrap audiences", async function _nonControlPlaneBootstrapAudience()
	{
		const result = await __ConsumeRuntimeBootstrap(new _BootstrapRepository(), { ..._bootstrap(), audience: "artifact-service" as RuntimeBootstrapClaim["audience"] }, { ..._bootstrapExpectation(), audience: "artifact-service" as RuntimeBootstrapExpectation["audience"] });

		expect(result).toEqual({ outcome: "denied", reason: "projected_token_audience_mismatch" });
	});

	it("keeps action PEP audiences independent from the control-plane bootstrap audience", async function _serviceSpecificActionAudience()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		const command = _command("one_shot");

		expect(command.expectation.capability.audience).toBe("artifact-service");
		expect((await __ExecuteCapabilityAction(repository, command, executor)).outcome).toBe("executed");
		expect(executor.count).toBe(1);
	});

	it("denies an in-flight duplicate, then returns the completed idempotent receipt", async function _idempotentReplay()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		const command = _command("idempotent");
		const results = await Promise.all([__ExecuteCapabilityAction(repository, command, executor), __ExecuteCapabilityAction(repository, command, executor)]);

		expect(executor.count).toBe(1);
		expect(results[0].outcome).toBe("executed");
		expect(results[1]).toEqual({ outcome: "denied", reason: "jti_replay" });
		const replay = await __ExecuteCapabilityAction(repository, command, executor);
		expect(replay.outcome).toBe("replayed");
		if (results[0].outcome !== "denied" && replay.outcome !== "denied") expect(replay.receipt.result).toBe(results[0].receipt.result);
	});

	it("denies an identical one-shot JTI replay", async function _oneShotReplay()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		const command = _command("one_shot");
		await __ExecuteCapabilityAction(repository, command, executor);

		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "jti_replay" });
		expect(executor.count).toBe(1);
	});

	it("denies the same JTI with a changed verified action fingerprint", async function _changedFingerprint()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		await __ExecuteCapabilityAction(repository, _command("idempotent"), executor);
		const changedCapability = _capability(__DigestCanonicalJson({ filename: "other.pdf" }));

		expect(await __ExecuteCapabilityAction(repository, _command("idempotent", changedCapability), executor)).toEqual({ outcome: "denied", reason: "jti_replay" });
		expect(executor.count).toBe(1);
	});

	it("never executes a JTI left Reserved by a crash before external I/O", async function _reservedCrash()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		const command = _command("idempotent");
		const capability = command.expectation.capability;
		await repository.reserve({
			jti: capability.jti,
			requestFingerprint: "sha256:reserved-before-crash",
			replayMode: command.replayMode,
			audience: capability.audience,
			siloId: capability.siloId,
			subjectId: capability.subjectId,
			serviceAccountName: capability.serviceAccountName,
			namespace: capability.namespace,
			workloadKind: capability.workloadKind,
			workloadUid: capability.workloadUid,
			podUid: capability.podUid,
			runId: capability.runId,
			attempt: capability.attempt,
			agentServiceId: capability.agentServiceId,
			agentRevisionId: capability.agentRevisionId,
			proofKeyThumbprint: capability.proofKeyThumbprint,
			catalogId: capability.capability.catalog.catalogId,
			catalogRevision: capability.capability.catalog.revision,
			catalogDigest: capability.capability.catalog.digest,
			capabilityId: capability.capability.capabilityId,
			effectivePolicyDigest: capability.effectiveAuthorizationDigest,
			resourceKind: capability.resource.kind,
			resourceId: capability.resource.id,
			action: capability.action,
			argumentsDigest: capability.argumentsDigest,
		});

		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "jti_replay" });
		expect(executor.count).toBe(0);
	});

	it("fails closed before external I/O when durable reservation is unavailable", async function _reservationUnavailable()
	{
		const repository = new _ReceiptRepository();
		repository.failReservation = true;
		const executor = new _Executor();

		expect(await __ExecuteCapabilityAction(repository, _command("idempotent"), executor)).toEqual({ outcome: "denied", reason: "action_reservation_failed" });
		expect(executor.count).toBe(0);
	});

	it("marks a thrown action Failed and never retries its JTI", async function _failedAction()
	{
		const repository = new _ReceiptRepository();
		const executor = new _ThrowingExecutor();
		const command = _command("idempotent");

		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "action_execution_failed" });
		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "jti_replay" });
		expect(executor.count).toBe(1);
	});

	it("fails closed after ambiguous success completion and never repeats the action", async function _ambiguousSuccess()
	{
		const repository = new _ReceiptRepository();
		repository.failSuccessfulCompletion = true;
		const executor = new _Executor();
		const command = _command("idempotent");

		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "action_execution_ambiguous" });
		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "jti_replay" });
		expect(executor.count).toBe(1);
	});

	it("fails closed when a thrown action cannot be marked Failed", async function _ambiguousFailure()
	{
		const repository = new _ReceiptRepository();
		repository.failFailureCompletion = true;
		const executor = new _ThrowingExecutor();

		expect(await __ExecuteCapabilityAction(repository, _command("one_shot"), executor)).toEqual({ outcome: "denied", reason: "action_execution_ambiguous" });
		expect(executor.count).toBe(1);
	});

	it("never reaches receipt state for a malformed cryptographic proof", async function _invalidProof()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		const command = { ..._command("one_shot"), compactProof: "not.a.proof" };

		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "malformed_header" });
		expect(executor.count).toBe(0);
	});

	it("rejects an invalid runtime replay mode before cryptographic or receipt work", async function _invalidReplayMode()
	{
		const repository = new _ReceiptRepository();
		const executor = new _Executor();
		const command = { ..._command("one_shot"), replayMode: "retry_forever" as "one_shot" };

		expect(await __ExecuteCapabilityAction(repository, command, executor)).toEqual({ outcome: "denied", reason: "invalid_replay_mode" });
		expect(executor.count).toBe(0);
	});
});
