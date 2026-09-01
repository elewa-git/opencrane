import { createHash, generateKeyPairSync, type JsonWebKey } from "node:crypto";

import { AgentRunState, Prisma, WarmRuntimeReservationState, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, WARM_RUNTIME_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type Es256PublicJwk } from "@opencrane/models/authorization";

import { PrismaWarmRuntimeBindingUnitOfWork } from "../prisma-warm-runtime-binding-authority";
import { PrismaWarmRuntimeBindingRepository, WarmRuntimeBindingConflict } from "../prisma-warm-runtime-binding-repository";

/** Generate valid public proof evidence for one runtime process. */
function _Proof(): { readonly proofPublicJwk: Es256PublicJwk; readonly proofKeyThumbprint: string }
{
	const exported = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" }) as JsonWebKey;
	const proofPublicJwk: Es256PublicJwk = { kty: "EC", crv: "P-256", x: exported.x ?? "", y: exported.y ?? "" };
	const canonical = JSON.stringify({ crv: proofPublicJwk.crv, kty: proofPublicJwk.kty, x: proofPublicJwk.x, y: proofPublicJwk.y });
	return { proofPublicJwk, proofKeyThumbprint: createHash("sha256").update(canonical, "utf8").digest("base64url") };
}

/** Creates the immutable subject carried by every durable run and runtime owner row. */
function _ExecutionSubject(): ExecutionSubject
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-01T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 3, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Build mutable rows and typed compare-and-set delegates for one ready warm reservation. */
function _Database(events: string[], options: { readonly failAt?: string; readonly serializationFailures?: number } = {})
{
	const future = new Date("2099-01-01T00:00:00.000Z");
	const executionSubject = _ExecutionSubject();
	const reservation = { runId: "run-1", attempt: 1, generation: 1, siloId: "silo-1", namespace: "runtime", deploymentName: "personal-warm", deploymentUid: "deployment-1", podName: "warm-pod-1", podUid: "pod-1", podResourceVersion: "13", genericProfile: "generic", claimedProfile: "personal", serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, state: WarmRuntimeReservationState.Ready as WarmRuntimeReservationState, proofKeyThumbprint: null as string | null, reservedAt: new Date(), profileActivatedAt: new Date(), readinessObservedAt: new Date(), boundAt: null as Date | null, idleDeadline: future, deleteRequestedAt: null as Date | null, deletedAt: null as Date | null };
	const assignment = { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, namespace: "runtime", workloadKind: WorkloadKind.Deployment, workloadUid: "assignment-1", workloadProfile: "personal-default", podUid: "pod-original", bindingGeneration: 1, state: WorkloadAssignmentState.PendingPod as WorkloadAssignmentState, expiresAt: future, createdAt: new Date(), registeredAt: null as Date | null, revokedAt: null as Date | null };
	const bootstrap = { id: "bootstrap-1", runId: "run-1", attempt: 1, generation: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, namespace: "runtime", workloadKind: WorkloadKind.Deployment, workloadUid: "assignment-1", claimDigest: "sha256:claim", expiresAt: future, consumedAt: null as Date | null, consumedByPodUid: null as string | null, revokedAt: null as Date | null, receiptId: null as string | null, createdAt: new Date() };
	const run = { id: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject, attempt: 1, state: AgentRunState.Assigned, inputSnapshot: { executionSubject, modelRoute: { alias: "silo-default", modelDefinitionId: "model-definition-1", litellmModelId: "litellm-model-1" }, budgetPolicy: { maxCostUsdMicros: 2_000_000 } } };
	let proofKey: { id: string; bootstrapId: string; runId: string; attempt: number; generation: number; workloadKind: WorkloadKind; workloadUid: string; podUid: string; publicKeyJwk: unknown; keyThumbprint: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date } | null = null;
	let mintAuthorization: { id: string; runId: string; attempt: number; generation: number; principalId: string; modelDefinitionId: string; providerConnectionId: string | null; authorizationDigest: string; keyAlias: string; expiresAt: Date; claimedAt: Date | null; createdAt: Date } | null = null;
	let serializationFailures = options.serializationFailures ?? 0;
	const transactionOptions: unknown[] = [];
	function _Count(label: string, matches = true): { readonly count: number }
	{
		events.push(label);
		return { count: matches && options.failAt !== label ? 1 : 0 };
	}
	const client = {
		async $transaction(operation: (transaction: unknown) => Promise<unknown>, transactionOption: unknown)
		{
			transactionOptions.push(transactionOption);
			if (serializationFailures > 0)
			{
				serializationFailures -= 1;
				throw new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "6.19.3" });
			}
			const snapshot = structuredClone({ reservation, assignment, bootstrap, run, proofKey, mintAuthorization });
			try
			{
				const result = await operation(client);
				events.push("commit");
				return result;
			}
			catch (error)
			{
				Object.assign(reservation, snapshot.reservation);
				Object.assign(assignment, snapshot.assignment);
				Object.assign(bootstrap, snapshot.bootstrap);
				Object.assign(run, snapshot.run);
				proofKey = snapshot.proofKey;
				mintAuthorization = snapshot.mintAuthorization;
				events.push("rollback");
				throw error;
			}
		},
		warmRuntimeReservation: {
			async findUnique() { return reservation; },
			async updateMany(args: { data: { state: WarmRuntimeReservationState; proofKeyThumbprint?: string; boundAt?: Date } })
			{
				const label = args.data.proofKeyThumbprint === undefined ? "fence:reservation" : "cas:reservation";
				const count = _Count(label, reservation.state === args.data.state || label === "cas:reservation");
				if (count.count === 1)
					Object.assign(reservation, args.data);
				return count;
			},
		},
		workloadAssignment: {
			async findUnique() { return assignment; },
			async updateMany(args: { data: { state: WorkloadAssignmentState; registeredAt: Date } })
			{
				const count = _Count("cas:assignment", assignment.state === WorkloadAssignmentState.PendingPod && assignment.revokedAt === null);
				if (count.count === 1)
					Object.assign(assignment, args.data);
				return count;
			},
		},
		workloadBootstrap: {
			async findUnique() { return bootstrap; },
			async updateMany(args: { data: { consumedAt: Date; consumedByPodUid: string; receiptId: string } })
			{
				const count = _Count("cas:bootstrap", bootstrap.consumedAt === null && bootstrap.consumedByPodUid === null && bootstrap.receiptId === null);
				if (count.count === 1)
					Object.assign(bootstrap, args.data);
				return count;
			},
		},
		agentRun: {
			async findUnique() { return run; },
			async updateMany() { return _Count("fence:run", run.state === AgentRunState.Assigned); },
		},
		runProofKey: {
			async findUnique() { return proofKey; },
			async create(args: { data: Omit<NonNullable<typeof proofKey>, "revokedAt" | "createdAt"> })
			{
				events.push("create:proof");
				proofKey = { ...args.data, revokedAt: null, createdAt: new Date() };
				return proofKey;
			},
		},
		modelDefinition: {
			async findUnique()
			{
				return { id: "model-definition-1", siloId: "silo-1", scope: "ClusterTenant", clusterTenant: "silo-1", publicModelName: "silo-default", litellmModelId: "litellm-model-1", providerCredential: { id: "provider-connection-1", siloId: "silo-1", scope: "ClusterTenant", clusterTenant: "silo-1" } };
			},
		},
		runModelCredentialMintAuthorization: {
			async findUnique() { return mintAuthorization; },
			async create(args: { data: Omit<NonNullable<typeof mintAuthorization>, "claimedAt" | "createdAt"> })
			{
				events.push("create:mint-authorization");
				mintAuthorization = { ...args.data, claimedAt: null, createdAt: new Date() };
				return mintAuthorization;
			},
			async updateMany(args: { data: { claimedAt: Date } })
			{
				const result = _Count("claim:mint-authorization", mintAuthorization !== null && mintAuthorization.claimedAt === null && mintAuthorization.expiresAt.getTime() > Date.now());
				if (result.count === 1 && mintAuthorization !== null)
					mintAuthorization.claimedAt = args.data.claimedAt;
				return result;
			},
		},
	};
	return { prisma: client as unknown as PrismaClient, reservation, assignment, bootstrap, run, transactionOptions, get proofKey() { return proofKey; }, get mintAuthorization() { return mintAuthorization; } };
}

/** Return a transaction-bound central authority that allows or denies exact Use admissions. */
function _AuthorizationFactory(allow = true)
{
	const admitPrincipal = vi.fn(async function _Admit(command: { readonly resource: { readonly kind: ProductAuthorizationResourceKinds }; readonly action: ProductAuthorizationActions })
	{
		if (!allow || command.action !== ProductAuthorizationActions.Use)
			return { outcome: "deny", reason: "no_grant", rule: null, evidence: null };
		const digest = command.resource.kind === ProductAuthorizationResourceKinds.ModelDefinition ? `sha256:${"a".repeat(64)}` : `sha256:${"b".repeat(64)}`;
		return { outcome: AuthorizationDecisionOutcomes.Allow, reason: "grant_allow", rule: {}, evidence: { decisionDigest: digest, policyRevisionHash: `sha256:${"c".repeat(64)}`, effectiveAuthorizationDigest: digest } };
	});
	return { factory: function _Create(_transaction?: Prisma.TransactionClient) { return { admitPrincipal } as never; }, admitPrincipal };
}

/** Build the reviewed identity used by every successful binding attempt. */
function _Identity()
{
	return { subject: "system:serviceaccount:runtime:warm-runtime", namespace: "runtime", serviceAccountName: WARM_RUNTIME_SERVICE_ACCOUNT_NAME, podUid: "pod-1" };
}

/** Build the transient key issuer used by binding tests. */
function _Issuer(events?: string[])
{
	return Object.assign(vi.fn(async function _Issue(_input?: { readonly expirySeconds: number })
	{
		events?.push("mint");
		return { key: "sk-attempt" };
	}), { revokeAttemptKey: vi.fn() });
}

/** Execute the persistence owner directly inside the fake serializable transaction. */
async function _BindRepository(database: ReturnType<typeof _Database>)
{
	const authorization = _AuthorizationFactory();
	return await database.prisma.$transaction(async function _Bind(transaction)
	{
		return await new PrismaWarmRuntimeBindingRepository(transaction, authorization.factory(transaction)).bind(_Identity(), _Proof());
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

describe("warm runtime binding persistence", function _Suite()
{
	it("commits the exact Pod and proof key before it mints the transient model key", async function _BindsAfterReadiness()
	{
		const events: string[] = [];
		const database = _Database(events);
		const issueAttemptModelKey = _Issuer(events);
		const authorization = _AuthorizationFactory();
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, authorization.factory);
		const proof = _Proof();

		await expect(authority.bind(_Identity(), proof)).resolves.toMatchObject({ outcome: "bound", attemptModelKey: "sk-attempt" });
		expect(events).toEqual(["fence:run", "fence:reservation", "cas:assignment", "cas:bootstrap", "create:proof", "create:mint-authorization", "cas:reservation", "commit", "claim:mint-authorization", "commit", "mint"]);
		expect(database.transactionOptions).toEqual([{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }]);
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Claimed);
		expect(database.assignment.state).toBe(WorkloadAssignmentState.Registered);
		expect(database.bootstrap.consumedByPodUid).toBe("pod-1");
		expect(database.proofKey?.keyThumbprint).toBe(proof.proofKeyThumbprint);
		expect(database.mintAuthorization?.claimedAt).not.toBeNull();
		expect(authorization.admitPrincipal).toHaveBeenCalledTimes(2);
		expect(authorization.admitPrincipal).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: "model-definition-1" }, action: ProductAuthorizationActions.Use }));
		expect(authorization.admitPrincipal).toHaveBeenNthCalledWith(2, expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: "provider-connection-1" }, action: ProductAuthorizationActions.Use }));
		expect(issueAttemptModelKey).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", modelAlias: "silo-default", maxBudgetUsd: 2 }));
	});

	it("never remints a key after the durable one-use authorization is spent", async function _FencesReplay()
	{
		const database = _Database([]);
		const issueAttemptModelKey = _Issuer();
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory().factory);
		const first = _Proof();

		await expect(authority.bind(_Identity(), first)).resolves.toMatchObject({ outcome: "bound" });
		await expect(authority.bind(_Identity(), first)).resolves.toEqual({ outcome: "conflict" });
		await expect(authority.bind(_Identity(), _Proof())).resolves.toEqual({ outcome: "conflict" });
		expect(issueAttemptModelKey).toHaveBeenCalledOnce();
	});

	it.each([
		["reservation", function _Expire(database: ReturnType<typeof _Database>, expired: Date) { database.reservation.idleDeadline = expired; }],
		["assignment", function _Expire(database: ReturnType<typeof _Database>, expired: Date) { database.assignment.expiresAt = expired; }],
		["bootstrap", function _Expire(database: ReturnType<typeof _Database>, expired: Date) { database.bootstrap.expiresAt = expired; }],
		["proof key", function _Expire(database: ReturnType<typeof _Database>, expired: Date) { if (database.proofKey !== null)
			database.proofKey.expiresAt = expired; }],
	])("rejects exact replay after the %s expires", async function _RejectsExpiredReplay(_label, expire)
	{
		const database = _Database([]);
		const issueAttemptModelKey = _Issuer();
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory().factory);
		const proof = _Proof();

		await expect(authority.bind(_Identity(), proof)).resolves.toMatchObject({ outcome: "bound" });
		expire(database, new Date("2000-01-01T00:00:00.000Z"));
		await expect(authority.bind(_Identity(), proof)).resolves.toEqual({ outcome: "conflict" });
		expect(issueAttemptModelKey).toHaveBeenCalledOnce();
	});

	it("limits a newly minted key to the remaining saved authority lifetime", async function _LimitsCredentialLifetime()
	{
		const clock = Date.now();
		const database = _Database([]);
		database.assignment.expiresAt = new Date(clock + 5_000);
		const now = vi.spyOn(Date, "now").mockReturnValue(clock);
		const issueAttemptModelKey = _Issuer();
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory().factory);

		try
		{
			await expect(authority.bind(_Identity(), _Proof())).resolves.toMatchObject({ outcome: "bound" });
			expect(issueAttemptModelKey).toHaveBeenCalledWith(expect.objectContaining({ expirySeconds: expect.any(Number) }));
			const call = issueAttemptModelKey.mock.calls[0]?.[0];
			expect(call?.expirySeconds).toBeGreaterThan(0);
			expect(call?.expirySeconds).toBeLessThanOrEqual(5);
		}
		finally
		{
			now.mockRestore();
		}
	});

	it("revokes a minted key when issuer latency would extend it past saved authority", async function _RevokesLateCredential()
	{
		let clock = Date.now();
		const database = _Database([]);
		database.assignment.expiresAt = new Date(clock + 5_000);
		const now = vi.spyOn(Date, "now").mockImplementation(function _Now() { return clock; });
		const revokeAttemptKey = vi.fn();
		const issueAttemptModelKey = Object.assign(vi.fn(async function _Issue()
		{
			clock += 2_000;
			return { key: "sk-late" };
		}), { revokeAttemptKey });
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory().factory);

		try
		{
			await expect(authority.bind(_Identity(), _Proof())).resolves.toEqual({ outcome: "conflict" });
			expect(revokeAttemptKey).toHaveBeenCalledWith(expect.objectContaining({ key: "sk-late" }));
		}
		finally
		{
			now.mockRestore();
		}
	});

	it.each([
		["a stale run attempt", function _StaleRun(database: ReturnType<typeof _Database>) { database.run.attempt = 2; }],
		["a reservation being deleted", function _DeletingReservation(database: ReturnType<typeof _Database>) { database.reservation.deleteRequestedAt = new Date(); }],
		["a revoked assignment", function _RevokedAssignment(database: ReturnType<typeof _Database>) { database.assignment.revokedAt = new Date(); }],
		["an already-consumed bootstrap", function _ConsumedBootstrap(database: ReturnType<typeof _Database>) { database.bootstrap.consumedAt = new Date(); database.bootstrap.consumedByPodUid = "pod-1"; database.bootstrap.receiptId = "receipt-old"; }],
		["mismatched aggregate ownership", function _MismatchedOwner(database: ReturnType<typeof _Database>) { database.bootstrap.executionSubject = { ...database.bootstrap.executionSubject, principalId: "principal-other" }; }],
	])("rejects %s before persistence commits", async function _RejectsStaleAggregate(_label, mutate)
	{
		const database = _Database([]);
		mutate(database);

		await expect(_BindRepository(database)).rejects.toBeInstanceOf(WarmRuntimeBindingConflict);
	});

	it.each(["fence:run", "fence:reservation", "cas:assignment", "cas:bootstrap", "cas:reservation"])("rolls back when %s loses its typed fence", async function _RollsBackLostFence(failAt)
	{
		const events: string[] = [];
		const database = _Database(events, { failAt });

		await expect(_BindRepository(database)).rejects.toBeInstanceOf(WarmRuntimeBindingConflict);
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Ready);
		expect(database.assignment.state).toBe(WorkloadAssignmentState.PendingPod);
		expect(database.bootstrap.consumedAt).toBeNull();
		expect(database.proofKey).toBeNull();
		expect(events.at(-1)).toBe("rollback");
	});

	it("retries a serialization conflict before it binds", async function _RetriesSerializationConflict()
	{
		const database = _Database([], { serializationFailures: 1 });
		const issueAttemptModelKey = _Issuer();
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory().factory);

		await expect(authority.bind(_Identity(), _Proof())).resolves.toMatchObject({ outcome: "bound" });
		expect(database.transactionOptions).toHaveLength(3);
		expect(issueAttemptModelKey).toHaveBeenCalledOnce();
	});

	it("rolls back the Pod binding when current model or provider Use is denied", async function _RejectsCurrentAuthorizationDenial()
	{
		const database = _Database([]);
		const issueAttemptModelKey = _Issuer();
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory(false).factory);

		await expect(authority.bind(_Identity(), _Proof())).resolves.toEqual({ outcome: "conflict" });
		expect(database.reservation.state).toBe(WarmRuntimeReservationState.Ready);
		expect(database.mintAuthorization).toBeNull();
		expect(issueAttemptModelKey).not.toHaveBeenCalled();
	});

	it("rejects malformed proof evidence before opening a transaction", async function _RejectsMalformedProof()
	{
		const database = _Database([]);
		const transaction = vi.spyOn(database.prisma, "$transaction");
		const issueAttemptModelKey = Object.assign(vi.fn(), { revokeAttemptKey: vi.fn() });
		const authority = new PrismaWarmRuntimeBindingUnitOfWork(database.prisma, { assignmentTtlMilliseconds: 60_000, issueAttemptModelKey }, _AuthorizationFactory().factory);
		const proof = _Proof();

		await expect(authority.bind(_Identity(), { ...proof, proofKeyThumbprint: "wrong" })).resolves.toEqual({ outcome: "conflict" });
		expect(transaction).not.toHaveBeenCalled();
		expect(issueAttemptModelKey).not.toHaveBeenCalled();
	});
});
