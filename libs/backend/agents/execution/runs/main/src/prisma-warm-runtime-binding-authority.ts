import { createHash, createPublicKey, randomUUID, type JsonWebKey } from "node:crypto";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, WARM_RUNTIME_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { WarmRuntimeReservationState, WorkloadAssignmentState, WorkloadKind, Prisma, type PrismaClient, type WarmRuntimeReservation, type WorkloadAssignment, type WorkloadBootstrap } from "@prisma/client";
import type { Es256PublicJwk } from "@opencrane/models/authorization";

import type { WarmRuntimeBindingAuthority, WarmRuntimeBindingIdentity, WarmRuntimeBindingResult, WarmRuntimeBindingSubmission } from "./warm-runtime-binding.types";
import type { AgentRunWorkflowControllerAuthorityOptions } from "./agent-run-workflow-controller-authority.types";
import { _BuildRunAttemptCredentialMintInputs } from "./run-attempt-credential-minting";

/** Retries database serialization conflicts while two requests race for one Pod. */
const _SERIALIZABLE_ATTEMPTS = 3;

/** Holds the database result needed to mint a key after the transaction commits. */
type WarmRuntimeDatabaseBindingResult =
	| { readonly outcome: "conflict" }
	| { readonly outcome: "bound" | "idempotent"; readonly receiptId: string; readonly runId: string; readonly attempt: number; readonly siloId: string; readonly modelRoute: unknown; readonly budgetPolicy: unknown };

/** Implements the one-use warm Pod proof-key exchange. */
export class PrismaWarmRuntimeBindingAuthority implements WarmRuntimeBindingAuthority
{
	/** Opens short transactions against product authority. */
	private readonly prisma: PrismaClient;
	/** Mints the raw attempt key only after proof binding commits. */
	private readonly options: Pick<AgentRunWorkflowControllerAuthorityOptions, "assignmentTtlMilliseconds" | "issueAttemptModelKey">;

	/** Create the binding authority over the main database. */
	constructor(prisma: PrismaClient, options: Pick<AgentRunWorkflowControllerAuthorityOptions, "assignmentTtlMilliseconds" | "issueAttemptModelKey">)
	{
		this.prisma = prisma;
		this.options = options;
	}

	/** Bind the first proof key only after profile readiness, or accept its exact retry. */
	async bind(identity: WarmRuntimeBindingIdentity, submission: WarmRuntimeBindingSubmission): Promise<WarmRuntimeBindingResult>
	{
		if (!_IdentityIsValid(identity) || !_SubmissionIsValid(submission)) return { outcome: "conflict" };
		let conflict: Prisma.PrismaClientKnownRequestError | null = null;
		for (let attempt = 1; attempt <= _SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				const bound = await this.prisma.$transaction(async function _Bind(transaction)
				{
					return await _BindInTransaction(transaction, identity, submission);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
				if (bound.outcome === "conflict") return bound;
				const credentials = _BuildRunAttemptCredentialMintInputs({ modelRoute: bound.modelRoute, budgetPolicy: bound.budgetPolicy, runId: bound.runId, attempt: bound.attempt, siloId: bound.siloId, assignmentTtlMilliseconds: this.options.assignmentTtlMilliseconds });
				if (credentials === null) return { outcome: "conflict" };
				const minted = await this.options.issueAttemptModelKey({ ...credentials, siloId: bound.siloId });
				if (typeof minted.key !== "string" || minted.key.length === 0) return { outcome: "conflict" };
				return { outcome: bound.outcome, receiptId: bound.receiptId, attemptModelKey: minted.key };
			}
			catch (error)
			{
				if (!(error instanceof Prisma.PrismaClientKnownRequestError) || (error.code !== "P2002" && error.code !== "P2034")) throw error;
				conflict = error;
			}
		}
		throw new Error("warm runtime binding conflicted after three attempts", { cause: conflict ?? undefined });
	}
}

/** Spend one exact ready reservation and open stream authority atomically. */
async function _BindInTransaction(transaction: Prisma.TransactionClient, identity: WarmRuntimeBindingIdentity, submission: WarmRuntimeBindingSubmission): Promise<WarmRuntimeDatabaseBindingResult>
{
	const discovered = await transaction.warmRuntimeReservation.findUnique({ where: { namespace_podUid: { namespace: identity.namespace, podUid: identity.podUid } } });
	if (discovered === null) return { outcome: "conflict" };
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${discovered.runId} FOR UPDATE`);
	await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "warm_runtime_reservations" WHERE "run_id" = ${discovered.runId} AND "attempt" = ${discovered.attempt} FOR UPDATE`);
	await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "run_id" = ${discovered.runId} AND "attempt" = ${discovered.attempt} FOR UPDATE`);
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "workload_bootstraps" WHERE "run_id" = ${discovered.runId} AND "attempt" = ${discovered.attempt} FOR UPDATE`);
	const reservation = await transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt: { runId: discovered.runId, attempt: discovered.attempt } } });
	const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: discovered.runId, attempt: discovered.attempt } } });
	const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { runId_attempt: { runId: discovered.runId, attempt: discovered.attempt } } });
	const run = await transaction.agentRun.findUnique({ where: { id: discovered.runId }, include: { inputSnapshot: true } });
	if (reservation === null || assignment === null || bootstrap === null || run === null || run.attempt !== discovered.attempt || run.inputSnapshot === null || !_RowsMatch(identity, reservation, assignment, bootstrap)) return { outcome: "conflict" as const };
	const proofKey = await transaction.runProofKey.findUnique({ where: { runId_attempt: { runId: discovered.runId, attempt: discovered.attempt } } });
	if (reservation.state === WarmRuntimeReservationState.Claimed)
	{
		return proofKey !== null && reservation.proofKeyThumbprint === submission.proofKeyThumbprint && proofKey.keyThumbprint === submission.proofKeyThumbprint && bootstrap.receiptId !== null
			? { outcome: "idempotent" as const, receiptId: bootstrap.receiptId, runId: run.id, attempt: run.attempt, siloId: run.siloId, modelRoute: run.inputSnapshot.modelRoute, budgetPolicy: run.inputSnapshot.budgetPolicy }
			: { outcome: "conflict" as const };
	}
	if (reservation.state !== WarmRuntimeReservationState.Ready || reservation.proofKeyThumbprint !== null || assignment.state !== WorkloadAssignmentState.PendingPod || bootstrap.consumedAt !== null || proofKey !== null) return { outcome: "conflict" as const };
	const now = new Date();
	if (reservation.idleDeadline.getTime() <= now.getTime() || assignment.expiresAt.getTime() <= now.getTime() || bootstrap.expiresAt.getTime() <= now.getTime()) return { outcome: "conflict" as const };
	const receiptId = randomUUID();
	const registered = await transaction.workloadAssignment.updateMany({ where: { runId: reservation.runId, attempt: reservation.attempt, state: WorkloadAssignmentState.PendingPod, workloadKind: WorkloadKind.Deployment, workloadUid: reservation.podUid, podUid: reservation.podUid }, data: { state: WorkloadAssignmentState.Registered, registeredAt: now } });
	if (registered.count !== 1) return { outcome: "conflict" as const };
	await transaction.workloadBootstrap.update({ where: { id: bootstrap.id }, data: { consumedAt: now, consumedByPodUid: identity.podUid, receiptId } });
	await transaction.runProofKey.create({ data: { id: randomUUID(), bootstrapId: bootstrap.id, runId: reservation.runId, attempt: reservation.attempt, workloadKind: WorkloadKind.Deployment, workloadUid: reservation.podUid, podUid: reservation.podUid, publicKeyJwk: submission.proofPublicJwk as unknown as Prisma.InputJsonValue, keyThumbprint: submission.proofKeyThumbprint, expiresAt: bootstrap.expiresAt } });
	const claimed = await transaction.warmRuntimeReservation.updateMany({ where: { runId: reservation.runId, attempt: reservation.attempt, state: WarmRuntimeReservationState.Ready, proofKeyThumbprint: null }, data: { state: WarmRuntimeReservationState.Claimed, proofKeyThumbprint: submission.proofKeyThumbprint, boundAt: now } });
	return claimed.count === 1 ? { outcome: "bound" as const, receiptId, runId: run.id, attempt: run.attempt, siloId: run.siloId, modelRoute: run.inputSnapshot.modelRoute, budgetPolicy: run.inputSnapshot.budgetPolicy } : { outcome: "conflict" as const };
}

/** Validate the reviewed identity before it selects a database row. */
function _IdentityIsValid(identity: WarmRuntimeBindingIdentity): boolean
{
	return identity.serviceAccountName === WARM_RUNTIME_SERVICE_ACCOUNT_NAME && identity.namespace.trim().length > 0 && identity.podUid.trim().length > 0;
}

/** Re-derive the submitted public-key thumbprint before any database mutation. */
function _SubmissionIsValid(submission: WarmRuntimeBindingSubmission): boolean
{
	try
	{
		return submission.proofKeyThumbprint.length <= 128 && _ComputeProofKeyThumbprint(submission.proofPublicJwk) === submission.proofKeyThumbprint;
	}
	catch
	{
		return false;
	}
}

/** Compute an RFC 7638 thumbprint only for an importable public P-256 key. */
function _ComputeProofKeyThumbprint(jwk: Es256PublicJwk): string
{
	const candidate = jwk as Es256PublicJwk & { readonly d?: unknown };
	if (candidate.kty !== "EC" || candidate.crv !== "P-256" || Object.hasOwn(candidate, "d") || !_IsP256Coordinate(candidate.x) || !_IsP256Coordinate(candidate.y)) throw new TypeError("warm runtime proof key must be a public P-256 JWK");
	createPublicKey({ key: candidate as JsonWebKey, format: "jwk" });
	const canonical = JSON.stringify({ crv: candidate.crv, kty: candidate.kty, x: candidate.x, y: candidate.y });
	return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

/** Accept one canonical unpadded base64url P-256 coordinate. */
function _IsP256Coordinate(value: unknown): value is string
{
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false;
	const decoded = Buffer.from(value, "base64url");
	return decoded.length === 32 && decoded.toString("base64url") === value;
}

/** Cross-check the reviewed Pod against reservation, assignment, and bootstrap authority. */
function _RowsMatch(identity: WarmRuntimeBindingIdentity, reservation: WarmRuntimeReservation, assignment: WorkloadAssignment, bootstrap: WorkloadBootstrap): boolean
{
	const runtimeAudience = assignment.audience === AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE || assignment.audience === MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE;
	return runtimeAudience && reservation.namespace === identity.namespace && reservation.podUid === identity.podUid && reservation.serviceAccountName === identity.serviceAccountName && assignment.namespace === identity.namespace && assignment.podUid === identity.podUid && assignment.serviceAccountName === identity.serviceAccountName && assignment.workloadKind === WorkloadKind.Deployment && assignment.workloadUid === identity.podUid && bootstrap.namespace === identity.namespace && bootstrap.serviceAccountName === identity.serviceAccountName && bootstrap.workloadKind === WorkloadKind.Deployment && bootstrap.workloadUid === identity.podUid;
}
