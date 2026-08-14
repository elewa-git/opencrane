import type { IntegrationAssignmentUnavailableReason } from "./external-action-executor.types";

/**
 * Thrown when the integration's live custody no longer allows the assignment frozen in the snapshot.
 *
 * Raised by `_ExecuteIntegrationExternalAction` after it re-resolves the assignment and before Obot
 * sees anything, so it proves no request reached the provider. That is why a catcher may treat it as
 * a definite failure: `_provenPreDispatchFailure` maps it to `integration_assignment_<reason>` and
 * the invocation is completed as failed rather than parked as ambiguous. Keeping that distinction
 * matters - reporting it as ambiguous would leave a revoked integration waiting for a person to
 * decide something that plainly never happened.
 *
 * Raised in integration-external-action-executor.ts; caught by `_provenPreDispatchFailure`
 * (production-external-action-adapter.ts).
 *
 * @see IntegrationToolReturnedError for the case where the tool did run.
 */
export class IntegrationAssignmentUnavailableError extends Error
{
	/** Short reason from the integration authority, safe to save and to log. */
	readonly reason: IntegrationAssignmentUnavailableReason;
	/** Integration id taken from the tool revision. It is not a credential. */
	readonly integrationId: string;

	/**
	 * Creates the error without keeping custody handles or the provider's error body.
	 *
	 * @param integrationId - Integration named by the tool revision; safe to log.
	 * @param reason - The integration authority's short reason, safe to save as durable evidence.
	 */
	constructor(integrationId: string, reason: IntegrationAssignmentUnavailableReason)
	{
		super(`integration assignment ${integrationId} is unavailable: ${reason}`);
		this.name = "IntegrationAssignmentUnavailableError";
		this.integrationId = integrationId;
		this.reason = reason;
	}
}

/** Typed safe failure when the provider completed the call with an MCP tool-level error. */
export class IntegrationToolReturnedError extends Error
{
	/** Creates the error without keeping the provider's error content. */
	constructor()
	{
		super("integration tool returned a failure result");
		this.name = "IntegrationToolReturnedError";
	}
}

/** Typed refusal when the current personal-memory receipt is absent, stale, or substituted. */
export class PersonalMemoryPermissionUnavailableError extends Error
{
	/** Create a bounded denial that carries no query or personal-memory content. */
	constructor()
	{
		super("personal memory permission is unavailable");
		this.name = "PersonalMemoryPermissionUnavailableError";
	}
}

/** Typed hand-off required until the transient non-persisting memory delivery path lands. */
export class PersonalMemorySafeDeliveryRequiredError extends Error
{
	/** Create a bounded stop after exact permission verification and before any Cognee request. */
	constructor()
	{
		super("personal memory requires the safe transient delivery path");
		this.name = "PersonalMemorySafeDeliveryRequiredError";
	}
}
