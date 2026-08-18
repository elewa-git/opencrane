import { ModelRoutingScope, type Prisma } from "@prisma/client";

import { DefaultModelDefinitionResolutionStatuses, type DefaultModelDefinitionResolution, type DefaultModelDefinitionResolver } from "./default-model-definition-resolver.types";

/** A persisted routing default reduced to the field that selects a public model. */
interface _RoutingDefault
{
	/** Scope whose precedence the row participates in. */
	readonly scope: ModelRoutingScope;
	/** Public model name configured at this scope, or null when only auto-routing is configured. */
	readonly defaultModel: string | null;
}

/** An accessible model definition reduced to its stable identity and precedence scope. */
interface _AccessibleModelDefinition
{
	/** Stable provider-catalogue identity stored on Agent revisions. */
	readonly id: string;
	/** Scope that decides whether the definition shadows the global fallback. */
	readonly scope: ModelRoutingScope;
}

/** Returns whether a routing row names a concrete public model. */
function _ConfiguredModelName(value: string | null): string | null
{
	if (value === null) return null;
	const configured = value.trim();
	return configured.length > 0 ? configured : null;
}

/** Returns one row at a precedence rung, or a fail-closed resolution when authority is absent or conflicting. */
function _UniqueAtScope<T>(rows: readonly T[]): T | DefaultModelDefinitionResolution
{
	if (rows.length > 1) return { status: DefaultModelDefinitionResolutionStatuses.Ambiguous };
	const row = rows[0];
	return row ?? { status: DefaultModelDefinitionResolutionStatuses.Unavailable };
}

/**
 * Resolves `ModelRoutingDefault.defaultModel` to one tenant-accessible `ModelDefinition.id`.
 *
 * The resolver reads only through the transaction supplied by its caller. A configured tenant
 * default wins over Global, but a tenant row with no concrete model does not hide the Global row.
 * Once a public model name is selected, a tenant-owned definition wins over a Global definition
 * with the same name. Missing, foreign-only, or conflicting rows deny the resolution before the
 * caller can publish executable state.
 *
 * Called by: `user-onboarding-composition.ts`, which adapts the result into agent-services' narrow
 * initial-publication port inside onboarding's Serializable transaction.
 * @see {@link DefaultModelDefinitionResolver}
 */
export class PrismaDefaultModelDefinitionResolverRepository implements DefaultModelDefinitionResolver
{
	/** Transaction-scoped ORM client supplied by the workflow that consumes the resolution. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds model-routing reads to the caller's existing transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Resolves the configured routing default to a model definition accessible to the silo.
	 *
	 * Called by: the initial-publication adapter in
	 * `apps/opencrane/src/app/user-onboarding-composition.ts` before it creates an AgentService.
	 *
	 * @returns `Resolved` with the selected definition, `Unavailable` when no configured accessible
	 * model exists, or `Ambiguous` when a precedence rung contains conflicting authority rows.
	 * @throws When Prisma cannot read the routing or model-definition authorities; the caller's
	 * transaction remains responsible for rollback.
	 */
	async resolve(siloId: string): Promise<DefaultModelDefinitionResolution>
	{
		if (siloId.trim().length === 0) return { status: DefaultModelDefinitionResolutionStatuses.Unavailable };
		const defaults = await this.transaction.modelRoutingDefault.findMany({
			where: {
				OR: [
					{ scope: ModelRoutingScope.ClusterTenant, clusterTenant: siloId },
					{ scope: ModelRoutingScope.Global, clusterTenant: null },
				],
			},
			select: { scope: true, defaultModel: true },
			orderBy: { id: "asc" },
			take: 4,
		});
		const selectedName = this._ResolveConfiguredName(defaults);
		if (typeof selectedName !== "string") return selectedName;
		return this._ResolveAccessibleDefinition(siloId, selectedName);
	}

	/** Applies tenant-before-Global default precedence without letting an empty tenant row shadow Global. */
	private _ResolveConfiguredName(defaults: readonly _RoutingDefault[]): string | DefaultModelDefinitionResolution
	{
		const tenantRows = defaults.filter(function _TenantDefault(row) { return row.scope === ModelRoutingScope.ClusterTenant; });
		if (tenantRows.length > 1) return { status: DefaultModelDefinitionResolutionStatuses.Ambiguous };
		const tenantName = _ConfiguredModelName(tenantRows[0]?.defaultModel ?? null);
		if (tenantName !== null) return tenantName;

		const globalRows = defaults.filter(function _GlobalDefault(row) { return row.scope === ModelRoutingScope.Global; });
		const global = _UniqueAtScope(globalRows);
		if ("status" in global) return global;
		return _ConfiguredModelName(global.defaultModel) ?? { status: DefaultModelDefinitionResolutionStatuses.Unavailable };
	}

	/** Resolves a public model name with tenant definitions taking precedence over Global definitions. */
	private async _ResolveAccessibleDefinition(siloId: string, publicModelName: string): Promise<DefaultModelDefinitionResolution>
	{
		const definitions = await this.transaction.modelDefinition.findMany({
			where: {
				publicModelName,
				OR: [
					{ scope: ModelRoutingScope.ClusterTenant, clusterTenant: siloId },
					{ scope: ModelRoutingScope.Global, clusterTenant: null },
				],
			},
			select: { id: true, scope: true },
			orderBy: { id: "asc" },
			take: 4,
		});
		return this._SelectAccessibleDefinition(definitions);
	}

	/** Selects exactly one row at the most specific accessible definition scope. */
	private _SelectAccessibleDefinition(definitions: readonly _AccessibleModelDefinition[]): DefaultModelDefinitionResolution
	{
		const tenantDefinitions = definitions.filter(function _TenantDefinition(row) { return row.scope === ModelRoutingScope.ClusterTenant; });
		if (tenantDefinitions.length > 0) return this._ResolvedDefinition(_UniqueAtScope(tenantDefinitions));
		const globalDefinitions = definitions.filter(function _GlobalDefinition(row) { return row.scope === ModelRoutingScope.Global; });
		return this._ResolvedDefinition(_UniqueAtScope(globalDefinitions));
	}

	/** Maps one unique definition row to success while preserving denial states. */
	private _ResolvedDefinition(definition: _AccessibleModelDefinition | DefaultModelDefinitionResolution): DefaultModelDefinitionResolution
	{
		if ("status" in definition) return definition;
		return { status: DefaultModelDefinitionResolutionStatuses.Resolved, modelDefinitionId: definition.id };
	}
}
