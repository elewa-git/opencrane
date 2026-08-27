import { createHash, generateKeyPairSync, type JsonWebKey } from "node:crypto";

import { AgentRunState, WarmRuntimeReservationState, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, WARM_RUNTIME_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import type { Es256PublicJwk } from "@opencrane/models/authorization";

import { PrismaWarmRuntimeBindingUnitOfWork } from "../prisma-warm-runtime-binding-authority";

/** Generate valid public proof evidence for one runtime process. */
function _Proof(): { readonly proofPublicJwk: Es256PublicJwk; readonly proofKeyThumbprint: string }
{
	const exported = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" }) as JsonWebKey;
	const proofPublicJwk: Es256PublicJwk = { kty: "EC", crv: "P-256", x: exported.x ?? "", y: exported.y ?? "" };
	const canonical = JSON.stringify({ crv: proofPublicJwk.crv, kty: proofPublicJwk.kty, x: proofPublicJwk.x, y: proofPublicJwk.y });
	return { proofPublicJwk, proofKeyThumbprint: createHash("sha256").update(canonical, "utf8").digest("base64url") };
}

/** Build mutable rows for one ready warm reservation. */
function _Database(events: string[])
{
	const future = new Date("2099-01-01T00:00:00.000Z");
	const reservation = { runId: "run-1", attempt: 1, siloId: "silo-1", namespace: "runtime", deploymentName: "personal-warm", deploymentUid: "deployment-1", podName: "warm-pod-1", podUid: "pod-1", podResourceVersion: "13", genericProfile: "generic", claimedProfile: "personal", serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, state: WarmRuntimeReservationState.Ready as WarmRuntimeReservationState, proofKeyThumbprint: null as string | null, reservedAt: new Date(), profileActivatedAt: new Date(), readinessObservedAt: new Date(), boundAt: null as Date | null, idleDeadline: future, deleteRequestedAt: null, deletedAt: null };
	const assignment = { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", subjectId: "user-1", audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, namespace: "runtime", workloadKind: WorkloadKind.Deployment, workloadUid: "pod-1", workloadProfile: "personal-default", podUid: "pod-1", state: WorkloadAssignmentState.PendingPod as WorkloadAssignmentState, expiresAt: future, createdAt: new Date(), registeredAt: null as Date | null, revokedAt: null };
	const bootstrap = { id: "bootstrap-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", subjectId: "user-1", audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, namespace: "runtime", workloadKind: WorkloadKind.Deployment, workloadUid: "pod-1", claimDigest: "sha256:claim", expiresAt: future, consumedAt: null as Date | null, consumedByPodUid: null as string | null, receiptId: null as string | null, createdAt: new Date() };
	const run = { id: "run-1", siloId: "silo-1", attempt: 1, state: AgentRunState.Assigned, inputSnapshot: { modelRoute: { publicModelName: "silo-default" }, budgetPolicy: { maxCostUsdMicros: 2_000_000 } } };
	let proofKey: { keyThumbprint: string } | null = null;
	const client = {
		async $transaction(operation: (transaction: unknown) => Promise<unknown>) { const result = await operation(client); events.push("commit"); return result; },
		async $queryRaw() { return []; },
		warmRuntimeReservation: {
			async findUnique() { return reservation; },
			async updateMany(args: { data: { state: WarmRuntimeReservationState; proofKeyThumbprint: string; boundAt: Date } }) { reservation.state = args.data.state; reservation.proofKeyThumbprint = args.data.proofKeyThumbprint; reservation.boundAt = args.data.boundAt; return { count: 1 }; },
		},
		workloadAssignment: {
			async findUnique() { return assignment; },
			async updateMany(args: { data: { state: WorkloadAssignmentState; registeredAt: Date } }) { assignment.state = args.data.state; assignment.registeredAt = args.data.registeredAt; return { count: 1 }; },
		},
		workloadBootstrap: {
			async findUnique() { return bootstrap; },
			async update(args: { data: { consumedAt: Date; consumedByPodUid: string; receiptId: string } }) { Object.assign(bootstrap, args.data); return bootstrap; },
		},
		agentRun: { async findUnique() { return run; } },
		runProofKey: {
			async findUnique() { return proofKey; },
			async create(args: { data: { keyThumbprint: string } }) { proofKey = { keyThumbprint: args.data.keyThumbprint }; return proofKey; },
		},
	};
	return { prisma: client as unknown as PrismaClient, reservation, assignment, bootstrap, get proofKey() { return proofKey; } };
}

describe("PrismaWarmRuntimeBindingUnitOfWork", function _Suite()
{
	it("commits the exact Pod and proof key before it mints the transient model key", async function _BindsAfterReadiness()
	{
		const events: string[] = [];
		const database = _Database(events);
		const issueAttemptModelKey = Object.assign(vi.fn(async function _Issue() { events.push("mint"); return { key: "sk-attempt" }; }), { revokeAttemptKey: vi.fn() });
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey });
		const proof = _Proof();

		await expect(authority.bind({ subject: "system:serviceaccount:runtime:warm-runtime", namespace: "runtime", serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, podUid: "pod-1" }, proof)).resolves.toMatchObject({ outcome: "bound", attemptModelKey: "sk-attempt" });
		expect(events).toEqual(["commit", "mint"]);
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Claimed);
		expect(database.assignment.state).toBe(WorkloadAssignmentState.Registered);
		expect(database.bootstrap.consumedByPodUid).toBe("pod-1");
		expect(database.proofKey?.keyThumbprint).toBe(proof.proofKeyThumbprint);
		expect(issueAttemptModelKey).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", modelAlias: "silo-default", maxBudgetUsd: 2 }));
	});

	it("accepts only the same proof key after the one-use binding", async function _FencesReplay()
	{
		const database = _Database([]);
		const issueAttemptModelKey = Object.assign(vi.fn(async function _Issue() { return { key: "sk-attempt" }; }), { revokeAttemptKey: vi.fn() });
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey });
		const identity = { subject: "system:serviceaccount:runtime:warm-runtime", namespace: "runtime", serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, podUid: "pod-1" };
		const first = _Proof();

		await expect(authority.bind(identity, first)).resolves.toMatchObject({ outcome: "bound" });
		await expect(authority.bind(identity, first)).resolves.toMatchObject({ outcome: "idempotent" });
		await expect(authority.bind(identity, _Proof())).resolves.toEqual({ outcome: "conflict" });
		expect(issueAttemptModelKey).toHaveBeenCalledTimes(2);
	});

	it("rejects malformed proof evidence before opening a transaction", async function _RejectsMalformedProof()
	{
		const database = _Database([]);
		const transaction = vi.spyOn(database.prisma, "$transaction");
		const issueAttemptModelKey = Object.assign(vi.fn(), { revokeAttemptKey: vi.fn() });
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey });
		const proof = _Proof();

		await expect(authority.bind({ subject: "system:serviceaccount:runtime:warm-runtime", namespace: "runtime", serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, podUid: "pod-1" }, { ...proof, proofKeyThumbprint: "wrong" })).resolves.toEqual({ outcome: "conflict" });
		expect(transaction).not.toHaveBeenCalled();
		expect(issueAttemptModelKey).not.toHaveBeenCalled();
	});
});
