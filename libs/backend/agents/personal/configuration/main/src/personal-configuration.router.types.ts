import type { Request } from "express";
import type { Logger } from "@opencrane/observability";

import type { PersonalConfigurationChangeDecisionRepository, PersonalConfigurationChangeViewRepository } from "./personal-configuration.types.js";
import type { PersonalConfigurationChangeMaterializationRepository } from "./personal-configuration-materialization.types.js";

/**
 * Stable error codes emitted by the owner-only personal configuration HTTP surface.
 *
 * These values are serialized into the shared error envelope. They identify the failed boundary
 * without exposing proposal existence or persistence details, so handlers and tests use enum
 * members instead of repeating wire strings.
 */
export enum PersonalConfigurationHttpErrorCodes
{
	/** The request has no authenticated browser owner. */
	AuthenticationRequired = "configuration_authentication_required",
	/** The owner's proposal history could not be read from the authority. */
	ListUnavailable = "configuration_list_unavailable",
	/** The decision payload or path coordinate does not satisfy the closed request contract. */
	InvalidDecision = "invalid_configuration_decision",
	/** The proposal is absent, non-owned, terminal, or otherwise undisclosable to this caller. */
	ChangeNotFound = "configuration_change_not_found",
	/** The decision authority could not produce an authoritative result. */
	DecisionUnavailable = "configuration_decision_unavailable",
	/** The materialization body or path coordinate does not satisfy the closed request contract. */
	InvalidMaterialization = "invalid_configuration_materialization",
	/** The materialization authority failed unexpectedly outside a mapped domain refusal. */
	MaterializationUnavailable = "configuration_materialization_unavailable",
}

/** Trusted browser identity for the owner-only configuration-proposal read surface. */
export interface PersonalConfigurationCaller
{
	/** Selected silo derived from the trusted request host. */
	readonly siloId: string;
	/** Signed-in user who owns the returned proposal history. */
	readonly userId: string;
}

/** Composition ports for the owner-only personal configuration state router. */
export interface PersonalConfigurationRouterDependencies
{
	/** Resolves the browser caller without accepting owner coordinates from request input. */
	resolveCaller(request: Request): PersonalConfigurationCaller | null;
	/** Reads only durable proposals owned by the resolved caller. */
	readonly changes: PersonalConfigurationChangeViewRepository;
	/** Atomically records an owner decision without applying the proposed patch. */
	readonly decisions: PersonalConfigurationChangeDecisionRepository;
	/** Applies one accepted model-alias proposal to a future immutable personal revision. */
	readonly materializer: PersonalConfigurationChangeMaterializationRepository;
	/** Supplies trusted decision timestamps. */
	readonly clock: { now(): Date };
	/** Records unexpected persistence failures without logging patch contents. */
	readonly logger: Logger;
}
