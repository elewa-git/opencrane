import { FirstPartyToolCapabilities } from "./compiled-run-input.types";

/** One built-in capability selected by server-owned run admission and sealed into the snapshot. */
export interface RunInputFirstPartyCapabilitySelection
{
	/** Closed built-in capability that admission selected for this attempt. */
	readonly capability: FirstPartyToolCapabilities;
	/** Stable semantic revision that the later compiler and dispatcher must match. */
	readonly capabilityRevision: string;
	/** Digest of the exact parameter schema the later compiler may expose to the model. */
	readonly parametersSchemaDigest: string;
}
