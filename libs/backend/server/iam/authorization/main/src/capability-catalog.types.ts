import type { CapabilityReference } from "@opencrane/models/authorization";

/** Reads immutable capability references without creating catalog authority. */
export interface CapabilityCatalogRepository
{
	/** Resolves one capability from an exact published catalog revision. */
	findCapability(catalogId: string, revision: number, capabilityId: string): Promise<CapabilityReference | null>;
}
