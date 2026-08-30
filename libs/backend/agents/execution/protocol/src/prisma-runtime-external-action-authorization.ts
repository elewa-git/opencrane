import type { Prisma } from "@prisma/client";

import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { PrismaAuthorizationAuthority, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { RunInputSnapshotIdentityKinds, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { RuntimeDispatchContext, RuntimeExternalActionAuthorization, RuntimeExternalActionAuthorizationRepository } from "./prisma-runtime-dispatch-authority.types";
import type { RuntimeAuthorizationAuthorityFactory, RuntimeExternalActionAuthorizationCoordinate, RuntimeExternalActionAuthorizationEvidence, RuntimeExternalActionEligibilityFactory, RuntimeExternalActionEligibilityPorts, RuntimeProductActor } from "./runtime-external-action-authorization.types";

/** Rechecks domain lifecycle and central product authority on one dispatch transaction. */
class RuntimeExternalActionAuthorizationCoordinator implements RuntimeExternalActionAuthorizationRepository
{
	/** Central product authority bound to the dispatch transaction. */
	private readonly authority: AuthorizationAuthority;
	/** Domain-owned current-lifecycle readers bound to the same transaction. */
	private readonly eligibility: RuntimeExternalActionEligibilityPorts;

	/**
	 * Creates the transaction-bound runtime product-authorization coordinator.
	 *
	 * @param authority - Central authority that records every allowed resource decision.
	 * @param eligibility - Domain-owned lifecycle readers bound by the app composition root.
	 */
	constructor(authority: AuthorizationAuthority, eligibility: RuntimeExternalActionEligibilityPorts)
	{
		this.authority = authority;
		this.eligibility = eligibility;
	}

	/** @inheritdoc */
	async admit(context: RuntimeDispatchContext, candidate: RuntimeExternalActionCandidate, now: Date): Promise<RuntimeExternalActionAuthorizationEvidence | null>
	{
		// 1. Reject altered arguments and incomplete actor coordinates before any authority read.
		const argumentsDigest = ___DigestCanonicalJson(candidate.arguments);
		if (argumentsDigest !== candidate.argumentsDigest)
			return null;
		const actor = _RuntimeActor(context);
		if (actor === null || !/^sha256:[0-9a-f]{64}$/u.test(context.assignmentDigest))
			return null;

		// 2. Reverify signed membership and the active published AgentRevision on this transaction.
		const membershipEligible = await this.eligibility.membership.isEligible({ siloId: context.siloId, identity: context.snapshot.identitySnapshot, nowEpochMs: now.getTime() });
		if (!membershipEligible)
			return null;
		const executionKind = context.snapshot.identitySnapshot.kind === RunInputSnapshotIdentityKinds.User ? "personal" : "managed";
		const agentEligible = await this.eligibility.agentService.isEligible({ siloId: context.siloId, agentServiceId: context.agentServiceId, agentRevisionId: context.agentRevisionId, executionKind, principalId: actor.principalId });
		if (!agentEligible)
			return null;

		// 3. Ask the owning product domain for current resource coordinates, never read its tables here.
		const coordinates = await this._EligibleCoordinates(context, candidate, actor);
		if (coordinates === null || coordinates.length === 0)
			return null;

		// 4. Admit the whole resource set as one evidence batch, so denial cannot leave partial receipts.
		const admissions = await this.authority.admitPrincipalBatch(coordinates.map(coordinate => ({ siloId: context.siloId, principalId: actor.principalId, actorKind: actor.actorKind, actorId: actor.actorId, resource: coordinate.resource, action: coordinate.action, argumentsDigest, membershipRevision: actor.membershipRevision, nowEpochMs: now.getTime() })));
		if (admissions.length !== coordinates.length || admissions.some(admission => admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null))
			return null;
		const decisionDigests = admissions.map(admission => admission.evidence?.decisionDigest).filter((digest): digest is `sha256:${string}` => digest !== undefined);

		// 5. Bind lifecycle, authority, assignment, and arguments into one stored evidence digest.
		const evidenceWithoutDigest = {
			principalId: actor.principalId,
			actorKind: actor.actorKind,
			coordinates: _CanonicalCoordinates(coordinates),
			decisionDigests: [...decisionDigests].sort(),
			membershipRevision: actor.membershipRevision,
			agentRevisionId: context.agentRevisionId,
			runId: context.runId,
			attempt: context.attempt,
			argumentsDigest,
			assignmentDigest: context.assignmentDigest as `sha256:${string}`,
		} as const;
		const evidenceDigest = ___DigestCanonicalJson(evidenceWithoutDigest as unknown as JsonValue);
		return { ...evidenceWithoutDigest, evidenceDigest };
	}

	/** Returns the current product coordinates selected by the owning domain. */
	private async _EligibleCoordinates(context: RuntimeDispatchContext, candidate: RuntimeExternalActionCandidate, actor: RuntimeProductActor): Promise<readonly RuntimeExternalActionAuthorizationCoordinate[] | null>
	{
		if (candidate.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION)
			return this._PersonalMemoryCoordinates(context, actor);
		if (candidate.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION)
			return this._UpgradeSessionCoordinates(context);
		const eligible = await this.eligibility.mcp.isEligible({ siloId: context.siloId, agentServiceId: context.agentServiceId, agentRevisionId: context.agentRevisionId, toolRevisionId: candidate.toolRevisionId });
		return eligible ? [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: candidate.toolRevisionId }, action: ProductAuthorizationActions.Invoke }] : null;
	}

	/** Returns both current personal-memory resources covered by recall. */
	private async _PersonalMemoryCoordinates(context: RuntimeDispatchContext, actor: RuntimeProductActor): Promise<readonly RuntimeExternalActionAuthorizationCoordinate[] | null>
	{
		if (context.snapshot.identitySnapshot.kind !== RunInputSnapshotIdentityKinds.User)
			return null;
		const datasetId = _PersonalMemoryDatasetId(context.snapshot.memoryQueryPolicy);
		if (datasetId === null || !await this.eligibility.personalMemory.isEligible({ siloId: context.siloId, datasetId, principalId: actor.principalId }))
			return null;
		return [
			{ resource: { kind: ProductAuthorizationResourceKinds.Dataset, id: datasetId }, action: ProductAuthorizationActions.Use },
			{ resource: { kind: ProductAuthorizationResourceKinds.MemoryScope, id: datasetId }, action: ProductAuthorizationActions.Use },
		];
	}

	/** Returns the active personal Persona profile covered by an upgrade proposal. */
	private async _UpgradeSessionCoordinates(context: RuntimeDispatchContext): Promise<readonly RuntimeExternalActionAuthorizationCoordinate[] | null>
	{
		if (context.snapshot.identitySnapshot.kind !== RunInputSnapshotIdentityKinds.User || context.personaRevisionId === null)
			return null;
		const profileId = await this.eligibility.persona.findEligibleProfileId({ siloId: context.siloId, userId: context.snapshot.identitySnapshot.executionSubjectId, personaRevisionId: context.personaRevisionId });
		return profileId === null ? null : [{ resource: { kind: ProductAuthorizationResourceKinds.Persona, id: profileId }, action: ProductAuthorizationActions.Use }];
	}
}

/** Creates one exact-transaction repository for every runtime external-action candidate. */
export class RuntimeExternalActionAuthorizationService implements RuntimeExternalActionAuthorization
{
	/** App-owned factory for transaction-bound domain lifecycle adapters. */
	private readonly eligibility: RuntimeExternalActionEligibilityFactory;
	/** Constructs the central authority over the exact dispatch transaction. */
	private readonly createAuthority: RuntimeAuthorizationAuthorityFactory;

	/**
	 * Creates the runtime effect authority without importing product-domain implementations.
	 *
	 * Called by: apps/opencrane/src/app/runtime-composition.ts.
	 * @param eligibility - App-owned binding of domain lifecycle adapters to each transaction.
	 * @param createAuthority - Optional central-authority factory used by focused tests.
	 */
	constructor(eligibility: RuntimeExternalActionEligibilityFactory, createAuthority: RuntimeAuthorizationAuthorityFactory = _CreateAuthorizationAuthority)
	{
		this.eligibility = eligibility;
		this.createAuthority = createAuthority;
	}

	/** @inheritdoc */
	admitInTransaction(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, candidate: RuntimeExternalActionCandidate, now: Date): Promise<RuntimeExternalActionAuthorizationEvidence | null>
	{
		const repository = new RuntimeExternalActionAuthorizationCoordinator(this.createAuthority(transaction), this.eligibility.bind(transaction));
		return repository.admit(context, candidate, now);
	}
}

/** Binds production admission to the shared product authority. */
function _CreateAuthorizationAuthority(transaction: Prisma.TransactionClient): AuthorizationAuthority
{
	return new PrismaAuthorizationAuthority(transaction);
}

/** Derives the central Principal from the full frozen identity, not the runtime frame. */
function _RuntimeActor(context: RuntimeDispatchContext): RuntimeProductActor | null
{
	const identity = context.snapshot.identitySnapshot;
	if (!Number.isSafeInteger(identity.fleetMembershipRevision) || identity.fleetMembershipRevision < 1)
		return null;
	if (identity.kind === RunInputSnapshotIdentityKinds.User)
	{
		if (!identity.principalId.trim() || !identity.executionSubjectId.trim())
			return null;
		return { principalId: identity.principalId, actorKind: "user", actorId: identity.principalId, membershipRevision: identity.fleetMembershipRevision };
	}
	if (!identity.executionSubjectId.trim() || identity.executionSubjectId !== `agent-service:${identity.agentServiceId}`)
		return null;
	return { principalId: identity.executionSubjectId, actorKind: "agent-service", actorId: identity.executionSubjectId, membershipRevision: identity.fleetMembershipRevision };
}

/** Orders resource coordinates before they become durable evidence. */
function _CanonicalCoordinates(coordinates: readonly RuntimeExternalActionAuthorizationCoordinate[]): readonly RuntimeExternalActionAuthorizationCoordinate[]
{
	return [...coordinates].sort(function _Compare(left, right): number
	{
		return `${left.resource.kind}:${left.resource.id}:${left.action}`.localeCompare(`${right.resource.kind}:${right.resource.id}:${right.action}`);
	});
}

/** Parses only the personal-memory coordinate frozen by run admission. */
function _PersonalMemoryDatasetId(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const policy = value as Readonly<Record<string, unknown>>;
	return policy["scope"] === "personal" && typeof policy["datasetId"] === "string" && policy["datasetId"].trim() ? policy["datasetId"] : null;
}
