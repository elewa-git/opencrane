import { AgentRevisionState, AgentServiceState, Prisma, type PrismaClient } from "@prisma/client";

import { __CreateCapabilitySet, __DigestCanonicalJson, __IsCapabilitySetSubset } from "@opencrane/backend/server/iam/authorization";
import type { CapabilitySet } from "@opencrane/backend/server/iam/authorization";
import type { CapabilityReference } from "@opencrane/models/authorization";
import type { RunInputSnapshot, RuntimeChildRunSpawnCandidate } from "@opencrane/contracts";

import { __AuthorizeGovernedChildRunSpawn } from "./child-run-admission.js";
import { __DeriveChildRunSnapshot } from "./child-run-snapshot.js";
import { PrismaChildRunReservationRepository } from "./prisma-child-run-reservation-repository.js";
import type { RuntimeChildRunSpawnPolicy } from "./prisma-runtime-child-run-spawn-runner.types.js";

/**
 * App-composable authority that turns an admitted runtime child request into one durable child run.
 *
 * The runner never trusts a runtime-provided capability list, revision, or parent capacity. Its
 * reservation callback holds the parent lock while it resolves the active target revision,
 * intersects its fixed ceiling with the parent snapshot, derives the frozen child snapshot, and
 * commits every child authority record together.
 */
export class PrismaRuntimeChildRunSpawnRunner
{
	/** Canonical product-authority client used only through the reservation transaction. */
	private readonly prisma: PrismaClient;
	/** Immutable bounds for recursive child execution. */
	private readonly policy: RuntimeChildRunSpawnPolicy;
	/** Server-owned clock shared with the reservation so child deadlines cannot outlive their parent. */
	private readonly nowEpochMs: () => number;

	/** Creates one child-run runner over the canonical product-authority database. */
	constructor(prisma: PrismaClient, policy: RuntimeChildRunSpawnPolicy, nowEpochMs: () => number = Date.now)
	{
		this.prisma = prisma;
		this.policy = policy;
		this.nowEpochMs = nowEpochMs;
	}

	/** Reserves the candidate only when the locked parent and active child revision prove every bound. */
	async run(candidate: RuntimeChildRunSpawnCandidate, snapshot: RunInputSnapshot): Promise<{ readonly outcome: "completed" | "denied" }>
	{
		if (!_isPolicyValid(this.policy) || candidate.runId !== snapshot.runId) return { outcome: "denied" };
		const command = {
			childRunId: _childRunId(candidate), requestIdempotencyKey: _idempotencyKey(candidate), parentRunId: candidate.runId, parentSnapshotDigest: snapshot.digest, parentAttempt: candidate.attempt,
			maximumChildrenPerParent: this.policy.maximumChildrenPerParent,
			request: { siloId: snapshot.siloId, agentServiceId: candidate.agentServiceId, capabilitySetDigest: candidate.capabilitySetDigest, context: candidate.context, budget: candidate.budget, task: candidate.task },
		};
		const policy = this.policy;
		const result = await new PrismaChildRunReservationRepository(this.prisma, undefined, this.nowEpochMs).reserve(command, async function _build(parent)
		{
			// 1. Reconfirm that the runtime frame names the exact snapshot currently locked for its parent.
			if (parent.snapshot.digest !== snapshot.digest) return null;

			// 2. Resolve only an active same-silo service and its published active revision under that lock.
			const target = await _targetRevision(parent.transaction, snapshot.siloId, candidate.agentServiceId);
			if (target === null) return null;

			// 3. Derive a verifier-owned child set by intersecting immutable parent evidence with the target ceiling.
			const childCapabilitySet = _narrowedCapabilitySet(parent.snapshot, target.capabilityCeiling);
			if (childCapabilitySet === null) return null;
			const admission = __AuthorizeGovernedChildRunSpawn({ runId: candidate.runId, rootRunId: parent.rootRunId, siloId: snapshot.siloId, snapshot: parent.snapshot, depth: parent.depth, remainingBudget: parent.remainingBudget }, command.request, parent.existingChildCount, policy, { resolve: function _resolve(parentCapabilitySet, childAgentServiceId, childCapabilitySetDigest) { return childAgentServiceId === target.id && childCapabilitySetDigest === childCapabilitySet.digest && __IsCapabilitySetSubset(parentCapabilitySet, childCapabilitySet) ? childCapabilitySet : null; } });
			if (admission.outcome === "denied") return null;

			// 4. Seal the verified target revision, capability set, and parent-bounded context into the child snapshot.
			const childSnapshot = __DeriveChildRunSnapshot({ childRunId: command.childRunId, parentSnapshot: parent.snapshot, authorization: admission.authorization, agentRevisionId: target.activeRevision.id, effectiveContractDigest: target.activeRevision.digest, promptCompilerVersion: target.activeRevision.promptPolicyVersion, compiledAt: parent.authorizedAt });
			return { authorization: admission.authorization, snapshot: childSnapshot, agentRevisionId: target.activeRevision.id, effectiveContractDigest: target.activeRevision.digest };
		});
		return result.outcome === "reserved" || result.outcome === "idempotent" ? { outcome: "completed" } : { outcome: "denied" };
	}
}

/** Reads the exact published active revision that may receive one same-silo child run. */
async function _targetRevision(transaction: Prisma.TransactionClient, siloId: string, agentServiceId: string): Promise<{ readonly id: string; readonly capabilityCeiling: Prisma.JsonValue; readonly activeRevision: { readonly id: string; readonly digest: string; readonly promptPolicyVersion: string } } | null>
{
	// 1. Hold the target service state stable until the same transaction commits its child authority.
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${agentServiceId} AND "silo_id" = ${siloId} FOR SHARE`);

	// 2. Load only an active service and published active revision after that lock has closed the state race.
	const service = await transaction.agentService.findFirst({ where: { id: agentServiceId, siloId, state: AgentServiceState.Active, activeRevisionId: { not: null } }, select: { id: true, activeRevision: { select: { id: true, digest: true, promptPolicyVersion: true, state: true, capabilityCeiling: true } } } });
	if (service?.activeRevision === null || service?.activeRevision === undefined || service.activeRevision.state !== AgentRevisionState.Published) return null;
	return { id: service.id, capabilityCeiling: service.activeRevision.capabilityCeiling, activeRevision: { id: service.activeRevision.id, digest: service.activeRevision.digest, promptPolicyVersion: service.activeRevision.promptPolicyVersion } };
}

/** Returns the exact intersection of parent evidence and a published target ceiling, or null for malformed authority. */
function _narrowedCapabilitySet(parent: RunInputSnapshot, ceiling: Prisma.JsonValue): CapabilitySet | null
{
	const parentSet = __CreateCapabilitySet(parent.capabilitySet);
	const targetReferences = _capabilityReferences(ceiling);
	const targetSet = targetReferences === null ? null : __CreateCapabilitySet(targetReferences);
	if (parentSet === null || targetSet === null) return null;
	const targetKeys = new Set(targetSet.capabilities.map(_capabilityKey));
	return __CreateCapabilitySet(parentSet.capabilities.filter(function _allowed(capability): boolean { return targetKeys.has(_capabilityKey(capability)); }));
}

/** Decodes a database JSON value only when every entry is a complete immutable capability reference. */
function _capabilityReferences(value: Prisma.JsonValue): CapabilityReference[] | null
{
	if (!Array.isArray(value)) return null;
	const references: CapabilityReference[] = [];
	for (const entry of value)
	{
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
		const record = entry as Record<string, unknown>;
		const catalog = record["catalog"];
		if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) return null;
		const catalogRecord = catalog as Record<string, unknown>;
		if (typeof catalogRecord["catalogId"] !== "string" || typeof catalogRecord["revision"] !== "number" || typeof catalogRecord["digest"] !== "string" || typeof record["capabilityId"] !== "string") return null;
		references.push({ catalog: { catalogId: catalogRecord["catalogId"], revision: catalogRecord["revision"], digest: catalogRecord["digest"] as `sha256:${string}` }, capabilityId: record["capabilityId"] });
	}
	return references;
}

/** Builds the stable immutable key used for set intersection. */
function _capabilityKey(value: CapabilityReference): string
{
	return `${value.catalog.catalogId}\u0000${value.catalog.revision}\u0000${value.catalog.digest}\u0000${value.capabilityId}`;
}

/** Derives a deterministic child identifier so a crashed runner can safely reserve the same child on replay. */
function _childRunId(candidate: RuntimeChildRunSpawnCandidate): string
{
	return `child-${__DigestCanonicalJson({ runId: candidate.runId, attempt: candidate.attempt, candidateId: candidate.candidateId }).slice("sha256:".length)}`;
}

/** Derives a deterministic scope-bound idempotency key for the admitted runtime candidate. */
function _idempotencyKey(candidate: RuntimeChildRunSpawnCandidate): string
{
	return `runtime-child:${candidate.runId}:${candidate.attempt}:${candidate.candidateId}`;
}

/** Returns whether bounded recursive policy values can safely enter the reservation authority. */
function _isPolicyValid(policy: RuntimeChildRunSpawnPolicy): boolean
{
	return Number.isSafeInteger(policy.maximumDepth) && policy.maximumDepth >= 1 && policy.maximumDepth <= 16
		&& Number.isSafeInteger(policy.maximumChildrenPerParent) && policy.maximumChildrenPerParent >= 1 && policy.maximumChildrenPerParent <= 64;
}
