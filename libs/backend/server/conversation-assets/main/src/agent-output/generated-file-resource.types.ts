/** Describes parsing only; every accepted resource still requires current execution and artifact authority. */
export enum GeneratedFileResourceOutcomes
{
	/** The admitted tool belongs to another result handler. */
	NotApplicable = "not_applicable",
	/** This producer returned a file shape that can enter encrypted custody. */
	Accepted = "accepted",
	/** This producer returned unsupported or malformed data, which must not enter ordinary result JSON. */
	Rejected = "rejected",
}

/** Checked file bytes awaiting capture in the current MCP completion transaction. */
export interface GeneratedFileResource
{
	/** Holds the filename from the admitted tool arguments, never a URI path. */
	readonly displayName: string;
	/** Holds the admitted media type. */
	readonly mediaType: string;
	/** Contains file bytes in memory; callers may persist them only through encrypted custody. */
	readonly bytes: Uint8Array;
	/** Binds promotion and scan recovery to these exact bytes. */
	readonly contentAddress: string;
	/** Binds capture replay to the whole original MCP result. */
	readonly rawResultDigest: string;
}

/** Separates unsupported producers from malformed results of the selected file producer. */
export type GeneratedFileResourceResult =
	| { readonly outcome: GeneratedFileResourceOutcomes.NotApplicable | GeneratedFileResourceOutcomes.Rejected }
	| { readonly outcome: GeneratedFileResourceOutcomes.Accepted; readonly file: GeneratedFileResource };
