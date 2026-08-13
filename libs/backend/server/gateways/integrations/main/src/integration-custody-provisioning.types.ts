import type { ObotCustodyCredential } from "@opencrane/backend/server/infra/obot-custody";
import type { Logger } from "@opencrane/backend/observability";

/** Just the `warn` and `error` methods of the platform logger — the only two the custody provisioning path needs, so a test can pass two functions instead of a whole logger. */
export type IntegrationCustodyLogger = Pick<Logger, "warn" | "error">;

/**
 * Everything needed to hand a user's credential to Obot for safekeeping and record the handle
 * Obot gives back.
 *
 * `credential` is the only place raw secret values appear in this package, and they travel
 * one way: straight to Obot. They are never written to Postgres, never logged, and never echoed
 * in a response. Everything stored afterwards is the opaque reference Obot returns.
 *
 * @see {@link ProvisionIntegrationCustodyResult} for the outcomes and the rollback rule.
 */
export interface ProvisionIntegrationCustodyCommand
{
	/** Silo owning the integration. */
	readonly siloId: string;
	/** Integration receiving custody. */
	readonly integrationId: string;
	/** Obot catalogue entry. */
	readonly obotCatalogEntryId: string;
	/**
	 * The raw credential entries, passed straight to Obot. Write-only: never stored in Postgres,
	 * never written to a log line, never returned in a response.
	 */
	readonly credential: readonly ObotCustodyCredential[];
}

/**
 * The one write this package makes after Obot has accepted a credential: record the handle Obot
 * returned.
 *
 * It is an interface so the provisioning function can be tested without a database, and so the
 * ordering rule is visible — nothing is written here until Obot has confirmed, which is why the
 * method is named `persistReady` rather than `create`.
 *
 * Called by: `__ProvisionIntegrationCustody` in ./integration-custody-provisioning.ts.
 * Implemented by `PrismaIntegrationCustodyRepository` in
 * ./prisma-integration-custody-repository.ts, which `_CreateIntegrationCustodyRouter` constructs.
 */
export interface IntegrationCustodyRepository
{
	/**
	 * Record the opaque reference Obot issued, as a Ready custody row for this integration.
	 *
	 * @param command - The silo, integration, catalogue entry, the Obot-issued reference, and the
	 *                  expiry Obot reported. No credential value is included.
	 * @returns The id of the custody row that was created.
	 * @throws Error when the integration is no longer an active row in that silo naming that
	 *         catalogue entry — which makes the caller revoke the remote custody it just created.
	 */
	persistReady(command: { readonly siloId: string; readonly integrationId: string; readonly obotCatalogEntryId: string; readonly obotCustodyReference: string; readonly expiresAt: Date }): Promise<{ readonly custodyReferenceId: string }>;
	persistReady(command: { readonly siloId: string; readonly integrationId: string; readonly obotCatalogEntryId: string; readonly obotCustodyReference: string; readonly expiresAt: Date }): Promise<{ readonly custodyReferenceId: string }>;
}

/**
 * Either custody was provisioned, or it was not — and the reason says what state Obot is in.
 *
 * - `provisioned` — Obot holds the credential and a Ready custody row records the handle.
 * - `remote_unavailable` — Obot refused, was unreachable, or returned something unusable. Nothing
 *   was stored, and anything Obot did create has been revoked. Safe to retry.
 * - `persistence_failed` — Obot accepted the credential but the local row could not be written, so
 *   the remote custody was revoked again. Nothing is left behind. Safe to retry.
 * - `compensation_failed` — the WORST case: the revoke itself failed, so Obot may still be holding
 *   usable custody that no local row tracks. This needs an operator; retrying will not clean it up.
 *
 * No branch carries credential material.
 */
export type ProvisionIntegrationCustodyResult = { readonly outcome: "provisioned"; readonly custodyReferenceId: string } | { readonly outcome: "unavailable"; readonly reason: "remote_unavailable" | "persistence_failed" | "compensation_failed" };
