/**
 * States returned when model-routing resolves the configured default to an executable definition.
 *
 * The application adapts these states into each consumer's vocabulary. Callers must treat every
 * state except {@link DefaultModelDefinitionResolutionStatuses.Resolved} as a denial.
 *
 * Called by: `PrismaDefaultModelDefinitionResolverRepository` and the OpenCrane composition root.
 * @see {@link DefaultModelDefinitionResolver}
 */
export enum DefaultModelDefinitionResolutionStatuses
{
	/** Exactly one accessible model definition matched the effective configured default. */
	Resolved = "resolved",
	/** No configured default or accessible model definition could be resolved. */
	Unavailable = "unavailable",
	/** More than one row claimed authority at the selected precedence rung. */
	Ambiguous = "ambiguous",
}

/** Successful configured-default resolution. */
interface ResolvedDefaultModelDefinition
{
	/** Stable success discriminator. */
	readonly status: DefaultModelDefinitionResolutionStatuses.Resolved;
	/** Stable provider-catalogue identifier stored by an executable Agent revision. */
	readonly modelDefinitionId: string;
}

/** Fail-closed configured-default resolution with one exact denial state. */
type DeniedDefaultModelDefinitionResolution =
	| { readonly status: DefaultModelDefinitionResolutionStatuses.Unavailable }
	| { readonly status: DefaultModelDefinitionResolutionStatuses.Ambiguous };

/** Complete result of resolving configured routing policy to one executable model definition. */
export type DefaultModelDefinitionResolution = ResolvedDefaultModelDefinition | DeniedDefaultModelDefinitionResolution;

/**
 * Resolves model-routing's effective default inside a transaction owned by another workflow.
 *
 * Implemented by: `PrismaDefaultModelDefinitionResolverRepository` in
 * `prisma-default-model-definition-resolver.ts`.
 * Called by: the OpenCrane app adapter for initial personal-Agent publication.
 */
export interface DefaultModelDefinitionResolver
{
	/** Resolves one tenant-accessible definition without committing the caller's transaction. */
	resolve(siloId: string): Promise<DefaultModelDefinitionResolution>;
}
