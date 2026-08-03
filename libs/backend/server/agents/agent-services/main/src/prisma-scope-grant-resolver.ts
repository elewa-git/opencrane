import { GrantAccess, GrantPayloadType, GrantScope, GrantSubjectType } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { EffectiveScopeGrant, ScopeGrantPrincipal, ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/**
 * Grant-compiler-backed effective-scope resolver.
 *
 * This is the REAL grant-compiler import that justifies re-opening the `scope:grants` edge on
 * `scope:agent-services`. It compiles Awareness (knowledge-scope) grants for the given principals and
 * keeps only the ALLOW winners. A Grant's `subjectId` is the principal receiving access; its
 * `payloadId` is the knowledge target. The resolver therefore projects `payloadId` (not the
 * receiving principal) into the attachment triple and derives the target kind from the independent
 * scope dimension. Deny/absent scopes never appear, so intersection can only filter, never widen.
 */
export class PrismaScopeGrantResolver implements ScopeGrantResolver
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient | Prisma.TransactionClient;

	/**
	 * Creates a resolver over canonical Postgres.
	 * @param prisma - OpenCrane Prisma client.
	 */
	constructor(prisma: PrismaClient | Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Compiles the allow-only effective knowledge-scope grants for the principal set. */
	async resolveEffectiveScopeGrants(principalInputs: readonly ScopeGrantPrincipal[]): Promise<readonly EffectiveScopeGrant[]>
	{
		// 1. Empty principal sets have no implicit access and avoid a broad database query.
		const principals = _Principals(principalInputs);
		if (principals.length === 0) return [];

		// 2. Read only the knowledge-scope grants for the supplied execution principals in winner order.
		const grants = await this.prisma.grant.findMany({
			where: { payloadType: GrantPayloadType.KnowledgeScope, OR: principals.map(function _PrincipalWhere(principal) { return { subjectType: _PersistedSubjectType(principal.subjectType), subjectId: principal.subjectId }; }) },
			select: { id: true, payloadId: true, scope: true, access: true, priority: true, createdAt: true },
		});

		// 3. Choose the same winner ordering as the canonical grant compiler: priority, deny, then newest.
		const winners = new Map<string, typeof grants[number]>();
		for (const grant of grants)
		{
			const scope = _Scope(grant.scope);
			if (scope === null || !grant.payloadId.trim()) continue;
			const subjectType = _TargetSubjectType(scope);
			const key = `${scope}\u0000${subjectType}\u0000${grant.payloadId}`;
			const current = winners.get(key);
			if (current === undefined || _Wins(grant, current)) winners.set(key, grant);
		}
		return [...winners.entries()]
			.filter(function _Allows(entry) { return entry[1].access === GrantAccess.Allow; })
			.map(function _Effective(entry): EffectiveScopeGrant
			{
				const [scope, subjectType, subjectId] = entry[0].split("\u0000");
				return { scope: scope as EffectiveScopeGrant["scope"], subjectType: subjectType as EffectiveScopeGrant["subjectType"], subjectId };
			})
			.sort(function _Canonical(left, right) { return `${left.scope}\u0000${left.subjectType}\u0000${left.subjectId}`.localeCompare(`${right.scope}\u0000${right.subjectType}\u0000${right.subjectId}`, "en"); });
	}
}

/** Removes malformed and duplicate typed principals before issuing the narrow authority query. */
function _Principals(inputs: readonly ScopeGrantPrincipal[]): readonly ScopeGrantPrincipal[]
{
	const unique = new Map<string, ScopeGrantPrincipal>();
	for (const input of inputs)
	{
		if (!input.subjectId.trim()) continue;
		unique.set(`${input.subjectType}\u0000${input.subjectId}`, input);
	}
	return [...unique.values()];
}

/** Maps the boundary's typed execution principal to the exact persisted grant-recipient enum. */
function _PersistedSubjectType(subjectType: ScopeGrantPrincipal["subjectType"]): GrantSubjectType
{
	switch (subjectType)
	{
		case "group": return GrantSubjectType.Group;
		case "service": return GrantSubjectType.Service;
		case "user": return GrantSubjectType.User;
	}
}

/** Returns whether one grant outranks another under the canonical priority, deny, newest ordering. */
function _Wins(next: { readonly access: GrantAccess; readonly priority: number; readonly createdAt: Date }, current: { readonly access: GrantAccess; readonly priority: number; readonly createdAt: Date }): boolean
{
	if (next.priority !== current.priority) return next.priority > current.priority;
	if (next.access !== current.access) return next.access === GrantAccess.Deny;
	return next.createdAt.getTime() > current.createdAt.getTime();
}

/** Maps the persisted grant scope to the attachment vocabulary. */
function _Scope(scope: GrantScope): EffectiveScopeGrant["scope"] | null
{
	switch (scope)
	{
		case GrantScope.Org: return "org";
		case GrantScope.Department: return "department";
		case GrantScope.Team: return "team";
		case GrantScope.Project: return "project";
		case GrantScope.Personal: return "personal";
		default: return null;
	}
}

/** Derives the target vocabulary from the independent knowledge-scope dimension. */
function _TargetSubjectType(scope: EffectiveScopeGrant["scope"]): EffectiveScopeGrant["subjectType"]
{
	return scope === "personal" ? "user" : "group";
}
