import type { Request } from "express";
import type { ProductAuthorizationActions } from "@opencrane/models/authorization";
import type { Logger } from "@opencrane/backend/observability";

import type { ConversationComputerLeaseCoordinates } from "../conversation-computers";

/**
 * Supplies the server-owned authorities needed to proxy human-review requests.
 *
 * Production callers provide the sandbox namespace from the release profile and a structured logger.
 * Tests may replace `fetch`, but no public route may supply either the namespace or the upstream
 * transport target. Failure logs omit request bodies and the derived review credential so diagnostics
 * do not disclose the bearer used by the sandbox gateway.
 *
 * @see _CreateConversationComputerReviewRouter
 */
export interface ConversationComputerReviewRouterOptions
{
	/** Resolves one currently authorized active sandbox route from projection and canonical history. */
	readonly authority: ConversationComputerReviewAuthority;
	/** Names the release-owned namespace that may contain assigned sandbox Services. */
	readonly sandboxNamespace: string;
	/** Performs the fixed upstream exchange; tests replace it without opening a socket. */
	readonly fetch?: typeof fetch;
	/** Records proxy failures without copying request bodies or the review credential into logs. */
	readonly logger: Pick<Logger, "warn">;
}

/**
 * Resolves review identity from the authenticated Express request, or returns `null` when no trusted
 * principal is available. The router never accepts these identity fields from route or body data.
 *
 * Called by: `_CreateConversationComputerReviewRouter` before conversation admission.
 */
export type ConversationComputerReviewPrincipalResolver = (request: Request) => { readonly externalSubject: string; readonly principalId: string; readonly siloId: string } | null;

/**
 * Carries authenticated participant coordinates into conversation review admission.
 *
 * The public router constructs this value from its principal resolver. None of these fields are
 * returned to the browser or used to choose the sandbox route directly.
 */
export interface ConversationComputerReviewCaller
{
	/** Stable local principal checked by central product authorization. */
	readonly principalId: string;
	/** Identity-provider subject checked against active conversation participation. */
	readonly subjectId: string;
	/** Silo selected from the trusted public request host. */
	readonly siloId: string;
}

/**
 * Carries the private upstream coordinates resolved from the active computer lease.
 *
 * These values stay in the server proxy. The router validates the Service DNS name against its
 * configured namespace and sends the derived review credential as the sandbox gateway bearer.
 */
export interface ConversationComputerReviewRoute
{
	/**
	 * Server-derived gateway bearer for the current lease, listing one credential per keyring key so a
	 * key rotation cannot lock out a live Pod. The Pod learns its own credential only through its
	 * bootstrap exchange.
	 */
	readonly reviewCredential: string;
	/** Controller-owned Sandbox name used only after DNS-label validation. */
	readonly sandboxId: string;
	/** Controller-reported Service DNS name persisted with the current active lease. */
	readonly serviceFQDN: string;
}

/**
 * Derives the review gateway bearer from lease coordinates under server-only keyring keys.
 *
 * The coordinates are the silo (from server configuration or the authenticated host), the computer
 * named on the Pod label, and the lease and generation that fence the credential; the lease id is
 * public and never acts as the credential by itself.
 *
 * `derive` gives a Pod the one credential it stores, keyed with the current key. `bearer` gives the
 * server everything it may present to that Pod: the same credential under every key still in the
 * keyring, current first, so the Pod still matches after `currentKeyId` moves during its lease.
 *
 * Called by: `_ConversationComputerReviewAuthority`, `HttpConversationComputerCheckpointSandbox` and
 * `ConversationComputerTurnAuthority`.
 *
 * @see KeyedConversationComputerReviewCredentialDeriver
 */
export interface ConversationComputerReviewCredentialDeriver
{
	/** Returns the same secret for the same lease under the current key and a different secret for any other lease. */
	derive(coordinates: ConversationComputerLeaseCoordinates): string;
	/** Returns the comma-separated credentials for the lease under every keyring key, current first. */
	bearer(coordinates: ConversationComputerLeaseCoordinates): string;
}

/**
 * Authorizes participant access and resolves the active, generation-fenced computer route.
 *
 * Implementations must apply the requested `Read` or `Use` action before loading lease coordinates.
 * They return `null` for failed admission or for an active lease without a routable sandbox, allowing
 * the HTTP layer to disclose neither which check failed nor any private coordinate.
 *
 * Called by: `_CreateConversationComputerReviewRouter` for every human-review request.
 */
export interface ConversationComputerReviewAuthority
{
	/**
	 * Resolves the server-only route after applying the requested product action.
	 *
	 * @returns The active lease route, or `null` when authorization or computer availability fails.
	 */
	resolve(caller: ConversationComputerReviewCaller, conversationId: string, action: ProductAuthorizationActions): Promise<ConversationComputerReviewRoute | null>;
}
