/**
 * Public service names returned by the unauthenticated OpenCrane health endpoint.
 *
 * These names describe capabilities a user can recognise. They deliberately avoid Kubernetes,
 * vendor, namespace, host, and credential details, so the same contract is safe for a browser,
 * operator, or external status check.
 *
 * Called by: the OpenCrane health aggregator, HTTP handler, and deployment smoke test. Values are
 * serialized on `GET /healthz`; renaming one is a breaking
 * wire-contract change.
 */
export enum PublicHealthServiceNames
{
	/** Represents the ingress-facing OpenCrane process that answered the request. */
	Api = "api",
	/** Represents the product database that must answer before the API accepts traffic. */
	Database = "database",
	/** Represents the configured model-routing service used by agent runs. */
	Models = "models",
	/** Represents the service that stores and recalls personal and organisational memory. */
	Memory = "memory",
	/** Represents the service that uploads, stores, and retrieves immutable files. */
	Files = "files",
	/** Represents the service that delivers live conversation events. */
	Channels = "channels",
	/** Represents the optional service for external tools and connectors. */
	Integrations = "integrations",
}

/**
 * Public availability states for one user-visible OpenCrane service.
 *
 * The values cross the unauthenticated HTTP boundary and may be rendered directly by a status UI.
 * They report availability only and never grant authority or expose a failure reason.
 *
 * Called by: the health aggregator and any client interpreting `PublicHealthReport.services`.
 * These exact strings are point-in-time, non-terminal wire states and are not persisted.
 */
export enum PublicHealthServiceStatuses
{
	/** The service answered this report's check; a later report may leave this state. */
	Available = "available",
	/** The configured service failed this report's check; a later report may recover. */
	Unavailable = "unavailable",
	/** The optional capability is absent from this deployment until its configuration changes. */
	Disabled = "disabled",
}

/**
 * Overall public health states derived from the service map.
 *
 * `degraded` does not by itself mean the API pod should leave readiness: callers must also inspect
 * `ready`, which remains tied to the API and its durable database authority.
 *
 * Called by: the health aggregator, handler fallback, deployment checks, and status consumers.
 * These exact strings are point-in-time, non-terminal wire states and are not persisted.
 */
export enum PublicHealthStatuses
{
	/** Every configured user-visible service is available in this report. */
	Ok = "ok",
	/** At least one configured user-visible service is unavailable in this report. */
	Degraded = "degraded",
}

/**
 * Requires a status for every public service name.
 *
 * The `Record` makes every enum member mandatory, so adding a serialized service forces report
 * producers to provide its state instead of silently omitting it.
 */
export type PublicHealthServices = Record<PublicHealthServiceNames, PublicHealthServiceStatuses>;

/**
 * Public response returned by `GET /healthz`.
 *
 * The response is safe without authentication: it contains only fixed service names and categorical
 * states. `ready` controls the HTTP readiness result, while `status` also reflects optional service
 * degradation that should remain visible without taking the whole API offline.
 *
 * Called by: the OpenCrane server's unauthenticated health handler and external readiness or status
 * consumers. The response is computed and cached briefly, never persisted.
 */
export interface PublicHealthReport
{
	/** Overall state across every configured service. */
	readonly status: PublicHealthStatuses;
	/** Whether the API and its database authority can accept traffic. */
	readonly ready: boolean;
	/** Fixed service map with no topology, tenant, provider, or error details. */
	readonly services: PublicHealthServices;
}
