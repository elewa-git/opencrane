import type { Prisma, PrismaClient } from "@prisma/client";

import { compileForPrincipals, GrantCompilerAccess, GrantCompilerPayloadType, GrantCompilerScope } from "@opencrane/backend/server/iam/grants";
import type { CompiledGrantDecision } from "@opencrane/backend/server/iam/grants";
import type { GrantScope, GrantSubjectType } from "@opencrane/models/agents";

import type { EffectiveScopeGrant, ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/** Maps a compiler scope enum to the canonical scope-attachment vocabulary. */
function _scope(value: GrantCompilerScope): GrantScope
{
	switch (value)
	{
		case GrantCompilerScope.Org: return "org";
		case GrantCompilerScope.Department: return "department";
		case GrantCompilerScope.Team: return "team";
		case GrantCompilerScope.Project: return "project";
		case GrantCompilerScope.Personal: return "personal";
	}
}

/** Derives the attached target kind from its independent authorization dimension. */
function _targetSubjectType(value: GrantCompilerScope): GrantSubjectType
{
	switch (value)
	{
		case GrantCompilerScope.Org: return "tenant";
		case GrantCompilerScope.Personal: return "user";
		case GrantCompilerScope.Department:
		case GrantCompilerScope.Team:
		case GrantCompilerScope.Project: return "group";
	}
}

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
	async resolveEffectiveScopeGrants(principalIds: readonly string[]): Promise<readonly EffectiveScopeGrant[]>
	{
		const decisions: CompiledGrantDecision[] = await compileForPrincipals([...principalIds], GrantCompilerPayloadType.Awareness, this.prisma);
		return decisions
			.filter(decision => decision.access === GrantCompilerAccess.Allow)
			.map(decision => ({ scope: _scope(decision.scope), subjectType: _targetSubjectType(decision.scope), subjectId: decision.payloadId }));
	}
}
