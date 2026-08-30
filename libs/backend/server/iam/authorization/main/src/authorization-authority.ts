import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationEvidenceKinds, ProductAuthorizationResourceKinds, __DecideAuthorization, __ProductAuthorizationCapability, __ProductAuthorizationRule, type AuthorizationBoundaryContext, type AuthorizationGrant, type AuthorizationSubject, type ProductAuthorizationCommand, type ProductAuthorizationResourceLocator, type ProductAuthorizationResult } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { AdmitPrincipalProductAuthorizationCommand, AdmitProductAuthorizationCommand, AdmitProductAuthorizationResult, AuthorizationAuthority, ListEntitledProductResourcesCommand, ListPrincipalEntitledProductResourcesCommand, ProductAuthorizationDecisionRecorder, ReplaceManagedProductAuthorizationGrantsCommand, ReplaceManagedProductAuthorizationGrantsResult, RetireProductAuthorizationResourceGrantsCommand, RetireProductAuthorizationResourceGrantsResult } from "./authorization-authority.types";
import type { AuthorizationResourceGrantRetirementRepository } from "./authorization-resource-grant-retirement.types";
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

/** One allowed Principal decision kept in memory until its complete batch is proven. */
interface AllowedPrincipalAdmission
{
	/** Boundary-specific command whose evidence will be recorded. */
	readonly command: AdmitProductAuthorizationCommand;
	/** Allowed catalogue decision produced for that boundary. */
	readonly decision: ProductAuthorizationResult;
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
	/** Exact-resource grant retirement writer bound to the same product transaction. */
	private readonly resourceGrantRetirement: AuthorizationResourceGrantRetirementRepository | null;

	/**
	 * Creates the authority over a repository owned by the caller's transaction.
	 * @param repository - Reads current Principal, Group, boundary, and grant facts.
	 */
	constructor(repository: AuthorizationContextRepository, recorder: ProductAuthorizationDecisionRecorder | null = null, managedGrants: ManagedAuthorizationGrantRepository | null = null, resourceGrantRetirement: AuthorizationResourceGrantRetirementRepository | null = null)
	{
		this.repository = repository;
		this.recorder = recorder;
		this.managedGrants = managedGrants;
		this.resourceGrantRetirement = resourceGrantRetirement;
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
		const result = this._BuildAdmission(command, decision);
		await this._RecordAdmission(command, result);
		return result;
	}

	/** @inheritdoc */
	async admitPrincipal(command: AdmitPrincipalProductAuthorizationCommand): Promise<AdmitProductAuthorizationResult>
	{
		const allowed = await this._DecidePrincipal(command);
		if (allowed !== null)
		{
			const result = this._BuildAdmission(allowed.command, allowed.decision);
			await this._RecordAdmission(allowed.command, result);
			return result;
		}
		const rule = __ProductAuthorizationRule(command.resource.kind, command.action);
		return { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule, evidence: null };
	}

	/** @inheritdoc */
	async admitPrincipalBatch(commands: readonly AdmitPrincipalProductAuthorizationCommand[]): Promise<readonly AdmitProductAuthorizationResult[]>
	{
		// 1. Decide the complete set before writing, so a denied coordinate cannot leave partial evidence.
		const allowed: AllowedPrincipalAdmission[] = [];
		for (const command of commands)
		{
			const decision = await this._DecidePrincipal(command);
			if (decision === null)
				return [];
			allowed.push(decision);
		}

		// 2. Build every receipt before recording any of them, so invalid evidence classes fail atomically.
		const results = allowed.map(item => this._BuildAdmission(item.command, item.decision));

		// 3. Record the complete allowed set through the transaction-owned writer.
		for (const [index, item] of allowed.entries())
			await this._RecordAdmission(item.command, results[index]);
		return results;
	}

	/** @inheritdoc */
	async listEntitled(command: ListEntitledProductResourcesCommand): Promise<readonly ProductAuthorizationResourceLocator[]>
	{
		// 1. An empty candidate set needs no identity or grant query.
		if (command.resources.length === 0)
		{
			return [];
		}
		this._RequireReadRules(command.action, command.resources);

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
		this._RequireReadRules(command.action, command.resources);

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

	/** @inheritdoc */
	async retireResourceGrants(command: RetireProductAuthorizationResourceGrantsCommand): Promise<RetireProductAuthorizationResourceGrantsResult>
	{
		if (this.resourceGrantRetirement === null)
		{
			throw new Error("resource grant retirement requires a transaction-bound repository");
		}

		// 1. Normalize exact coordinates so duplicate or reordered input cannot change retirement evidence.
		const resources = _NormalizeRetiringResources(command.resources);
		if (resources.length === 0)
			throw new Error("resource grant retirement requires at least one exact resource");

		// 2. Recheck root administration and record its complete retirement intent before changing grants.
		const argumentsDigest = ___DigestCanonicalJson({ operation: "retire-product-resource-grants", resources } as unknown as JsonValue);
		const admission = await this.admitPrincipal({ siloId: command.siloId, principalId: command.principalId, actorKind: command.actorKind, actorId: command.actorId, action: ProductAuthorizationActions.Administer, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: command.siloId }, argumentsDigest, nowEpochMs: command.nowEpochMs });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
			return { ...admission, changedCount: 0 };

		// 3. Revoke every manager's active grant before the owning domain deletes these same resources.
		const changedCount = await this.resourceGrantRetirement.retireResourceGrants({ siloId: command.siloId, resources, now: command.now });
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

	/** Finds the first stored Principal boundary that allows one admission command. */
	private async _DecidePrincipal(command: AdmitPrincipalProductAuthorizationCommand): Promise<AllowedPrincipalAdmission | null>
	{
		const subjects = await this.repository.resolvePrincipalSubjects(command.siloId, command.principalId);
		const boundaries = [
			{ kind: AuthorizationBoundaryKinds.Personal, principalId: command.principalId } as const,
			...subjects.flatMap(subject => subject.kind === AuthorizationSubjectKinds.Group ? [{ kind: AuthorizationBoundaryKinds.Group, groupId: subject.groupId } as const] : []),
		];
		for (const boundary of boundaries)
		{
			const boundedCommand = { ...command, boundary };
			const decision = await this.decide(boundedCommand);
			if (decision.outcome === AuthorizationDecisionOutcomes.Allow)
				return { command: boundedCommand, decision };
		}
		return null;
	}

	/** Builds authority-derived evidence without writing it, which lets batch admission fail as a set. */
	private _BuildAdmission(command: AdmitProductAuthorizationCommand, decision: ProductAuthorizationResult): AdmitProductAuthorizationResult
	{
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.rule === null || decision.rule.evidence === ProductAuthorizationEvidenceKinds.Read)
			throw new Error("authorization admission requires an allowed mutation or effect catalogue rule");
		if (this.recorder === null)
			throw new Error("authorization admission requires a transaction-bound decision recorder");
		const effectiveAuthorizationDigest = ___DigestCanonicalJson({ grantIds: [...decision.grantIds].sort() } as JsonValue);
		const policyRevisionHash = __ProductAuthorizationCapability(command.resource.kind, command.action)?.catalog.digest;
		if (policyRevisionHash === undefined)
			throw new Error("authorization admission lost its catalogue capability");
		const decisionDigest = ___DigestCanonicalJson({ siloId: command.siloId, principalId: command.principalId, actorKind: command.actorKind, actorId: command.actorId, boundary: command.boundary, requiredBoundaryCoverage: command.requiredBoundaryCoverage ?? null, resource: command.resource, action: command.action, argumentsDigest: command.argumentsDigest, policyRevisionHash, effectiveAuthorizationDigest, grantIds: [...decision.grantIds].sort(), outcome: decision.outcome, reason: decision.reason, nowEpochMs: command.nowEpochMs } as unknown as JsonValue);
		return { ...decision, evidence: { decisionDigest, policyRevisionHash, effectiveAuthorizationDigest } };
	}

	/** Writes one prebuilt allowed result through the transaction-bound recorder. */
	private async _RecordAdmission(command: AdmitProductAuthorizationCommand, result: AdmitProductAuthorizationResult): Promise<void>
	{
		if (this.recorder === null)
			throw new Error("authorization admission requires a transaction-bound decision recorder");
		await this.recorder.record(command, result);
	}

	/** Rejects batch filtering for actions whose catalogue rule requires durable evidence. */
	private _RequireReadRules(action: ProductAuthorizationActions, resources: readonly ProductAuthorizationResourceLocator[]): void
	{
		for (const resource of resources)
		{
			const rule = __ProductAuthorizationRule(resource.kind, action);
			if (rule === null || rule.evidence !== ProductAuthorizationEvidenceKinds.Read)
				throw new Error(`authorization catalogue filtering requires a Read-class rule: ${resource.kind}:${action}`);
		}
	}
}

/** Deduplicates and sorts exact resource coordinates before evidence or persistence uses them. */
function _NormalizeRetiringResources(resources: readonly ProductAuthorizationResourceLocator[]): readonly ProductAuthorizationResourceLocator[]
{
	const unique = new Map<string, ProductAuthorizationResourceLocator>();
	for (const resource of resources)
	{
		if (resource.kind.length === 0 || resource.id.length === 0)
			throw new Error("resource grant retirement received an empty resource coordinate");
		unique.set(`${resource.kind}\0${resource.id}`, resource);
	}
	return [...unique.values()].sort(function _Compare(left, right)
	{
		const kind = left.kind.localeCompare(right.kind);
		return kind === 0 ? left.id.localeCompare(right.id) : kind;
	});
}
