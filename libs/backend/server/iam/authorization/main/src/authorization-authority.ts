import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationEvidenceKinds, ProductAuthorizationResourceKinds, __DecideAuthorization, __ProductAuthorizationCapability, __ProductAuthorizationRule, type AuthorizationBoundaryContext, type AuthorizationGrant, type AuthorizationSubject, type ProductAuthorizationCommand, type ProductAuthorizationResourceLocator, type ProductAuthorizationResult } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { AdmitPrincipalProductAuthorizationCommand, AdmitProductAuthorizationCommand, AdmitProductAuthorizationResult, AuthorizationAuthority, ListEntitledProductResourcesCommand, ListManagedProductAuthorizationGrantsCommand, ListPrincipalEntitledProductResourcesCommand, ProductAuthorizationDecisionRecorder, ReplaceManagedProductAuthorizationGrantsCommand, ReplaceManagedProductAuthorizationGrantsResult } from "./authorization-authority.types";
import type { AuthorizationContextRepository } from "./authorization-resolution.types";
import type { ManagedAuthorizationGrantRepository } from "./managed-authorization-grants.types";

/** Current Principal, Group, grant, and boundary facts shared by one or more decisions. */
interface ResolvedAuthorizationContext
{
	/** Principal and direct Groups resolved from current product authority. */
	readonly subjects: readonly AuthorizationSubject[];
	/** Grants held by the resolved subjects. */
	readonly grants: readonly AuthorizationGrant[];
	/** Stored ancestry for the requested product boundary. */
	readonly boundaryContext: AuthorizationBoundaryContext;
}

/** Evaluates every product action through one current grant and membership context. */
export class __AuthorizationAuthority implements AuthorizationAuthority
{
	/** Product-authority reader bound to the caller's database transaction. */
	private readonly repository: AuthorizationContextRepository;
	/** Durable evidence writer bound to the same transaction, when admission is supported. */
	private readonly recorder: ProductAuthorizationDecisionRecorder | null;
	/** Generic managed-grant writer bound to the same transaction, when mutation is supported. */
	private readonly managedGrants: ManagedAuthorizationGrantRepository | null;

	/**
	 * Creates the authority over a repository owned by the caller's transaction.
	 * @param repository - Reads current Principal, Group, boundary, and grant facts.
	 */
	constructor(repository: AuthorizationContextRepository, recorder: ProductAuthorizationDecisionRecorder | null = null, managedGrants: ManagedAuthorizationGrantRepository | null = null)
	{
		this.repository = repository;
		this.recorder = recorder;
		this.managedGrants = managedGrants;
	}

	/** @inheritdoc */
	async decide(command: ProductAuthorizationCommand): Promise<ProductAuthorizationResult>
	{
		// 1. Reject resource-action pairs missing from the reviewed catalogue before reading grants.
		const rule = __ProductAuthorizationRule(command.resource.kind, command.action);
		const capability = __ProductAuthorizationCapability(command.resource.kind, command.action);
		if (rule === null || capability === null)
		{
			return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule: null };
		}

		// 2. Load current identity, grants, and boundary evidence through the transaction-bound reader.
		const context = await this._ResolveContext(command.siloId, command.principalId, command.boundary);
		if (context.subjects.length === 0)
		{
			return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule };
		}

		// 3. Apply the one pure policy kernel to the typed resource and capability coordinates.
		const decision = __DecideAuthorization({ siloId: command.siloId, subjects: context.subjects, boundary: command.boundary, capability, resource: command.resource, nowEpochMs: command.nowEpochMs }, context.grants, context.boundaryContext);
		if (decision.outcome === AuthorizationDecisionOutcomes.Allow && command.requiredBoundaryCoverage === AuthorizationBoundaryCoverages.Descendants)
		{
			const winningGrantIds = new Set(decision.grantIds);
			const coversDescendants = context.grants.some(grant => winningGrantIds.has(grant.grantId) && grant.boundaryCoverage === AuthorizationBoundaryCoverages.Descendants);
			if (!coversDescendants)
			{
				return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "insufficient_boundary_coverage", grantIds: decision.grantIds, rule };
			}
		}
		return { ...decision, rule };
	}

	/** @inheritdoc */
	async admit(command: AdmitProductAuthorizationCommand): Promise<AdmitProductAuthorizationResult>
	{
		const decision = await this.decide(command);
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
		{
			return { ...decision, evidence: null };
		}
		if (decision.rule === null || decision.rule.evidence === ProductAuthorizationEvidenceKinds.Read)
		{
			throw new Error("authorization admission requires a mutation or effect catalogue rule");
		}
		if (this.recorder === null)
		{
			throw new Error("authorization admission requires a transaction-bound decision recorder");
		}

		const effectiveAuthorizationDigest = ___DigestCanonicalJson({ grantIds: [...decision.grantIds].sort() } as JsonValue);
		const policyRevisionHash = __ProductAuthorizationCapability(command.resource.kind, command.action)?.catalog.digest;
		if (policyRevisionHash === undefined)
		{
			throw new Error("authorization admission lost its catalogue capability");
		}
		const decisionDigest = ___DigestCanonicalJson({
			siloId: command.siloId,
			principalId: command.principalId,
			actorKind: command.actorKind,
			actorId: command.actorId,
			boundary: command.boundary,
			requiredBoundaryCoverage: command.requiredBoundaryCoverage ?? null,
			resource: command.resource,
			action: command.action,
			argumentsDigest: command.argumentsDigest,
			policyRevisionHash,
			effectiveAuthorizationDigest,
			grantIds: [...decision.grantIds].sort(),
			outcome: decision.outcome,
			reason: decision.reason,
			nowEpochMs: command.nowEpochMs,
		} as unknown as JsonValue);
		const result = { ...decision, evidence: { decisionDigest, policyRevisionHash, effectiveAuthorizationDigest } };
		await this.recorder.record(command, result);
		return result;
	}

	/** @inheritdoc */
	async admitPrincipal(command: AdmitPrincipalProductAuthorizationCommand): Promise<AdmitProductAuthorizationResult>
	{
		const subjects = await this.repository.resolvePrincipalSubjects(command.siloId, command.principalId);
		const boundaries = [
			{ kind: AuthorizationBoundaryKinds.Personal, principalId: command.principalId } as const,
			...subjects.flatMap(subject => subject.kind === AuthorizationSubjectKinds.Group ? [{ kind: AuthorizationBoundaryKinds.Group, groupId: subject.groupId } as const] : []),
		];
		for (const boundary of boundaries)
		{
			const result = await this.admit({ ...command, boundary });
			if (result.outcome === AuthorizationDecisionOutcomes.Allow)
			{
				return result;
			}
		}
		const rule = __ProductAuthorizationRule(command.resource.kind, command.action);
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule, evidence: null };
	}

	/** @inheritdoc */
	async listEntitled(command: ListEntitledProductResourcesCommand): Promise<readonly ProductAuthorizationResourceLocator[]>
	{
		// 1. An empty candidate set needs no identity or grant query.
		if (command.resources.length === 0)
		{
			return [];
		}

		// 2. Load shared context once so catalogue size cannot multiply database authorization reads.
		const context = await this._ResolveContext(command.siloId, command.principalId, command.boundary);
		if (context.subjects.length === 0)
		{
			return [];
		}

		// 3. Apply the catalogue rule and pure decision independently to each domain-owned candidate.
		return command.resources.filter(resource => this._DecideWithContext(command, resource, context).outcome === AuthorizationDecisionOutcomes.Allow);
	}

	/** @inheritdoc */
	async listPrincipalEntitled(command: ListPrincipalEntitledProductResourcesCommand): Promise<readonly ProductAuthorizationResourceLocator[]>
	{
		// 1. An empty candidate set needs no identity or grant query.
		if (command.resources.length === 0)
		{
			return [];
		}

		// 2. Resolve the Principal and direct Groups from product authority, never request claims.
		const subjects = await this.repository.resolvePrincipalSubjects(command.siloId, command.principalId);
		if (subjects.length === 0)
		{
			return [];
		}
		const grants = await this.repository.listSubjectGrants(command.siloId, subjects);
		const boundaries = [
			{ kind: AuthorizationBoundaryKinds.Personal, principalId: command.principalId } as const,
			...subjects.flatMap(subject => subject.kind === AuthorizationSubjectKinds.Group ? [{ kind: AuthorizationBoundaryKinds.Group, groupId: subject.groupId } as const] : []),
		];
		const contexts = await Promise.all(boundaries.map(boundary => this.repository.resolveBoundaryContext(command.siloId, boundary)));

		// 3. Keep a resource when any stored actor boundary has a winning allow grant.
		return command.resources.filter(resource =>
		{
			const rule = __ProductAuthorizationRule(resource.kind, command.action);
			const capability = __ProductAuthorizationCapability(resource.kind, command.action);
			if (rule === null || capability === null)
			{
				return false;
			}
			return boundaries.some(function _Allowed(boundary, index)
			{
				const decision = __DecideAuthorization({ siloId: command.siloId, subjects, boundary, capability, resource, nowEpochMs: command.nowEpochMs }, grants, contexts[index]);
				return decision.outcome === AuthorizationDecisionOutcomes.Allow;
			});
		});
	}

	/** @inheritdoc */
	async listManagedGrants(command: ListManagedProductAuthorizationGrantsCommand)
	{
		if (this.managedGrants === null)
		{
			throw new Error("managed grant reads require a transaction-bound repository");
		}
		const entitled = await this.listPrincipalEntitled({ siloId: command.siloId, principalId: command.principalId, action: ProductAuthorizationActions.Administer, resources: [{ kind: ProductAuthorizationResourceKinds.Organization, id: command.siloId }], nowEpochMs: command.nowEpochMs });
		if (entitled.length !== 1)
		{
			return [];
		}
		return this.managedGrants.listManagedResourceGrants(command.siloId, command.managerId, command.resource);
	}

	/** @inheritdoc */
	async replaceManagedGrants(command: ReplaceManagedProductAuthorizationGrantsCommand): Promise<ReplaceManagedProductAuthorizationGrantsResult>
	{
		if (this.managedGrants === null)
		{
			throw new Error("managed grant replacement requires a transaction-bound repository");
		}
		const argumentsDigest = ___DigestCanonicalJson({ managerId: command.managerId, resource: command.resource, grants: command.grants } as unknown as JsonValue);
		const admission = await this.admitPrincipal({ siloId: command.siloId, principalId: command.principalId, actorKind: command.actorKind, actorId: command.actorId, action: ProductAuthorizationActions.Administer, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: command.siloId }, argumentsDigest, nowEpochMs: command.nowEpochMs });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
		{
			return { ...admission, changedCount: 0 };
		}
		const changedCount = await this.managedGrants.reconcileManagedResourceGrants({ siloId: command.siloId, managerId: command.managerId, resource: command.resource, grants: command.grants, now: command.now });
		return { ...admission, changedCount };
	}

	/** Decides one batch candidate with identity and grant facts loaded by the surrounding call. */
	private _DecideWithContext(command: ListEntitledProductResourcesCommand, resource: ProductAuthorizationResourceLocator, context: ResolvedAuthorizationContext): ProductAuthorizationResult
	{
		const rule = __ProductAuthorizationRule(resource.kind, command.action);
		const capability = __ProductAuthorizationCapability(resource.kind, command.action);
		if (rule === null || capability === null)
		{
			return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule: null };
		}
		const decision = __DecideAuthorization({ siloId: command.siloId, subjects: context.subjects, boundary: command.boundary, capability, resource, nowEpochMs: command.nowEpochMs }, context.grants, context.boundaryContext);
		return { ...decision, rule };
	}

	/** Loads the current identity, grants, and boundary facts used by one decision group. */
	private async _ResolveContext(siloId: string, principalId: string, boundary: ProductAuthorizationCommand["boundary"]): Promise<ResolvedAuthorizationContext>
	{
		const [subjects, boundaryContext] = await Promise.all([
			this.repository.resolvePrincipalSubjects(siloId, principalId),
			this.repository.resolveBoundaryContext(siloId, boundary),
		]);
		const grants = await this.repository.listSubjectGrants(siloId, subjects);
		return { subjects, grants, boundaryContext };
	}
}
