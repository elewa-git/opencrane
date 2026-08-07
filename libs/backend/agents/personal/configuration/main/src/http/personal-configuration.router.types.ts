import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { PersonalConfigurationChangeDecisionRepository } from "../decision/personal-configuration-decision.types.js";
import type { PersonalConfigurationChangeMaterializationRepository } from "../materialization/personal-configuration-materialization.types.js";
import type { PersonalConfigurationChangeViewRepository } from "../query/personal-configuration-view.types.js";

/** Stable error payload codes returned by the owner-only configuration routes. */
export enum PersonalConfigurationHttpErrors
{
	/** The request has no authenticated personal owner. */
	AuthenticationRequired = "configuration_authentication_required",
	/** Proposal history could not be read. */
	ListUnavailable = "configuration_list_unavailable",
	/** The owner decision payload is malformed. */
	InvalidDecision = "invalid_configuration_decision",
	/** The proposal is absent, hidden, or no longer decidable. */
	ChangeNotFound = "configuration_change_not_found",
	/** The decision authority could not produce a durable result. */
	DecisionUnavailable = "configuration_decision_unavailable",
	/** The materialisation request body or path is malformed. */
	InvalidMaterialization = "invalid_configuration_materialization",
	/** The materialisation authority could not produce a durable result. */
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
