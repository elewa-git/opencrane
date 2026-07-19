import type { ObotCustodyCredential } from "@opencrane/server/_infra/obot-custody";
import type { Logger } from "@opencrane/observability";

/** Structured logger methods used by the custody provisioning operation. */
export type IntegrationCustodyLogger = Pick<Logger, "warn" | "error">;

/** Request to provision remote custody for an integration. */
export interface ProvisionIntegrationCustodyCommand
{
	/** Silo owning the integration. */
	readonly siloId: string;
	/** Integration receiving custody. */
	readonly integrationId: string;
	/** Obot catalogue entry. */
	readonly obotCatalogEntryId: string;
	/** Write-only credential material. */
	readonly credential: readonly ObotCustodyCredential[];
}

/** Product persistence boundary for remote custody confirmation. */
export interface IntegrationCustodyRepository
{
	/** Stores an Obot-issued reference after remote provisioning succeeds. */
	persistReady(command: { readonly siloId: string; readonly integrationId: string; readonly obotCatalogEntryId: string; readonly obotCustodyReference: string; readonly expiresAt: Date }): Promise<{ readonly custodyReferenceId: string }>;
}

/** Fail-closed custody provisioning outcome. */
export type ProvisionIntegrationCustodyResult = { readonly outcome: "provisioned"; readonly custodyReferenceId: string } | { readonly outcome: "unavailable"; readonly reason: "remote_unavailable" | "persistence_failed" | "compensation_failed" };
