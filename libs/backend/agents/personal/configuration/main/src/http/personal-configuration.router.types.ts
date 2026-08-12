import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { PersonalConfigurationChangeDecisionRepository } from "../decision/personal-configuration-decision.types.js";
import type { PersonalConfigurationChangeMaterializationRepository } from "../materialization/personal-configuration-materialization.types.js";
import type { PersonalConfigurationChangeViewRepository } from "../query/personal-configuration-view.types.js";

/**
 * The `error` values the configuration routes put in a JSON body.
 *
 * `ChangeNotFound` is returned both for a proposal that does not exist and for one that belongs
 * to another user or was already decided, so a client cannot use 404s to discover other users'
 * proposals. The two `*Unavailable` codes are the only ones a client should retry; the
 * `Invalid*` codes mean the request itself must change.
 *
 * These strings appear in the OpenAPI document and in browser code — do not rename them.
 */
export enum PersonalConfigurationHttpErrors
{
	/** The request has no authenticated personal owner. */
	AuthenticationRequired = "configuration_authentication_required",
	/** Proposal history could not be read. */
	ListUnavailable = "configuration_list_unavailable",
	/** The owner decision payload is malformed. */
	InvalidDecision = "invalid_configuration_decision",
	/** The proposal does not exist, belongs to someone else, or was already decided. */
	ChangeNotFound = "configuration_change_not_found",
	/** The decision could not be written. */
	DecisionUnavailable = "configuration_decision_unavailable",
	/** The materialisation request body or path is malformed. */
	InvalidMaterialization = "invalid_configuration_materialization",
	/** The change could not be applied. */
	MaterializationUnavailable = "configuration_materialization_unavailable",
}

/** Who the request is from, worked out by the server and never taken from request input. */
export interface PersonalConfigurationCaller
{
	/** Selected silo derived from the trusted request host. */
	readonly siloId: string;
	/** Signed-in user who owns the returned proposal history. */
	readonly userId: string;
}

/** Everything the configuration router needs, supplied when it is composed. */
export interface PersonalConfigurationRouterDependencies
{
	/** Returns who the request is from, ignoring any owner ids in the request itself. */
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
