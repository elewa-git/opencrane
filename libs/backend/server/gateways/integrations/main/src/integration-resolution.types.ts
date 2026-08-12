import type { ReviewedIntegrationToolDefinition } from "@opencrane/models/agents";

/**
 * Asks the server which integration an agent revision may use, just before a run starts.
 *
 * All three ids are supplied by the caller, but the silo id is NOT taken from request input — the
 * executor passes the silo it is already running for. The repository then requires the stored
 * assignment to name that same silo, so one customer's revision can never resolve another
 * customer's integration even if the integration id is guessed.
 *
 * @see {@link ResolveIntegrationAssignmentResult} for what comes back.
 */
export interface ResolveIntegrationAssignmentCommand
{
	/** Silo that owns the AgentRevision and integration. */
	readonly siloId: string;
	/** Immutable revision selecting the integration. */
	readonly agentRevisionId: string;
	/** Exact integration selected by the revision. */
	readonly integrationId: string;
}

/**
 * The usable integration, returned only when it is active and its custody has not expired.
 *
 * No credential value is ever included. `obotCustodyReference` is an opaque handle the Obot
 * gateway issued; the executor passes it back to Obot, which looks up the real secret on its own
 * side. Reading this object gives an attacker nothing to authenticate with.
 *
 * @see {@link ResolveIntegrationAssignmentResult} for the failure side of the union.
 */
export interface ResolvedIntegrationAssignment
{
	/** Silo-scoped integration identity. */
	readonly integrationId: string;
	/** Obot catalogue entry selected by the product authority. */
	readonly obotCatalogEntryId: string;
	/** Opaque Obot-issued custody handle; it is not credential material. */
	readonly obotCustodyReference: string;
	/** The tool definitions that were reviewed and stored on this revision; a deep copy, so the caller cannot mutate the stored row. */
	readonly toolDefinitions: readonly ReviewedIntegrationToolDefinition[];
}

/**
 * Either the integration is usable, or it is not — and the reason tells the caller what to do.
 *
 * - `not_found` — no such assignment, or it belongs to a different silo. Treat as a permanent
 *   failure; retrying will not help.
 * - `inactive` — the integration row is not Active, custody is not Ready, or the stored tool
 *   definitions failed validation. Needs an operator to fix the integration.
 * - `revoked` — custody was revoked. The user must reconnect the integration.
 * - `expired` — custody's `expiresAt` has passed. Custody must be provisioned again; see
 *   `__ProvisionIntegrationCustody` in ./integration-custody-provisioning.ts.
 *
 * Neither branch carries credential material.
 */
export type ResolveIntegrationAssignmentResult =
	| { readonly outcome: "resolved"; readonly assignment: ResolvedIntegrationAssignment }
	| { readonly outcome: "unavailable"; readonly reason: "not_found" | "inactive" | "revoked" | "expired" };

/**
 * The read side of integration resolution: the one way the agent runtime asks whether it may use
 * an integration, and gets back the opaque handle to do so.
 *
 * Read-only on purpose — nothing behind this interface writes, so a compromised runtime cannot
 * change an assignment, only ask about one. It is an interface so the executor can be tested
 * against a fake.
 *
 * Called by: `integration-external-action-executor.ts` in
 * libs/backend/agents/execution/protocol/src, through the `integrations` field of
 * `ExternalActionExecutorDependencies`. Implemented by
 * `PrismaIntegrationAuthorityRepository` (./prisma-integration-authority.ts), which
 * apps/opencrane/src/app/external-action-composition.ts constructs.
 */
export interface IntegrationAuthorityRepository
{
	/**
	 * Look up the integration a revision selected, and return it only if it is usable right now.
	 *
	 * @param command - The silo, revision, and integration to resolve. The silo must match the one
	 *                  stored on the assignment.
	 * @returns `{ outcome: "resolved" }` with the opaque custody handle and reviewed tool
	 *          definitions, or `{ outcome: "unavailable" }` with the reason — see
	 *          {@link ResolveIntegrationAssignmentResult} for what each reason means for the caller.
	 */
	resolveAssignment(command: ResolveIntegrationAssignmentCommand): Promise<ResolveIntegrationAssignmentResult>;
	resolveAssignment(command: ResolveIntegrationAssignmentCommand): Promise<ResolveIntegrationAssignmentResult>;
}

/**
 * Supplies "now" for the custody expiry check.
 *
 * It is injected rather than read from the system clock inside the repository for two reasons: the
 * expiry test becomes testable without waiting, and — the point that matters in production — the
 * time comes from the server, never from the caller. A runtime that could pass its own timestamp
 * could keep using custody that has already expired.
 *
 * Called by: `PrismaIntegrationAuthorityRepository.resolveAssignment`
 * (./prisma-integration-authority.ts). Implemented by `__SystemIntegrationAuthorityClock` in the
 * same file, which apps/opencrane/src/app/external-action-composition.ts constructs.
 */
export interface IntegrationAuthorityClock
{
	/** @returns The current server time, compared against a custody reference's `expiresAt`. */
	now(): Date;
}
