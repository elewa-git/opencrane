import type { IntegrationAssignmentUnavailableReason } from "./external-action-executor.types.js";

/** Typed fail-closed result when live integration custody no longer authorizes the frozen assignment. */
export class IntegrationAssignmentUnavailableError extends Error
{
	/** Safe bounded authority reason suitable for durable evidence and structured logs. */
	readonly reason: IntegrationAssignmentUnavailableReason;
	/** Credential-free integration identifier named by the frozen tool revision. */
	readonly integrationId: string;

	/** Creates a bounded failure without retaining custody handles or downstream error payloads. */
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
	/** Creates a bounded failure without retaining the provider's error content. */
	constructor()
	{
		super("integration tool returned a failure result");
		this.name = "IntegrationToolReturnedError";
	}
}
