import type { ObotCustodyCredential } from "@opencrane/backend/_server/obot-custody";

/** Validated request body accepted by the org-admin custody provisioning route. */
export interface ProvisionIntegrationCustodyRequestBody
{
	/** Obot catalogue entry the integration's remote MCP server is created from. */
	readonly obotCatalogEntryId: string;
	/** Write-only credential entries passed straight to Obot; never persisted or echoed. */
	readonly credential: readonly ObotCustodyCredential[];
}
