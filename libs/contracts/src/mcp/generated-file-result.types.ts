/**
 * Marks server-created metadata for a file captured from an admitted MCP invocation.
 * This value describes stored work; it does not authorize a file read or prove a clean scan.
 */
export enum GeneratedFileResultKinds
{
	/** The file has entered private custody and still requires publication checks. */
	Captured = "generated_file_captured",
}

/**
 * Replaces embedded file bytes in the saved tool result after encrypted capture commits.
 * The operation and artifact coordinates must be read from server persistence, never accepted
 * from an MCP server's own structured output. Downloads retain current Artifact/Read checks.
 */
export interface GeneratedFileResultMetadata
{
	/** Identifies captured file metadata without claiming that scanning finished. */
	readonly kind: GeneratedFileResultKinds.Captured;
	/** Identifies the immutable generated-file operation and its Absurd task. */
	readonly operationId: string;
	/** Identifies the conversation's file row. */
	readonly assetId: string;
	/** Identifies the human-owned logical artifact. */
	readonly artifactId: string;
	/** Identifies the planned immutable revision; it may not yet exist or be published. */
	readonly artifactRevisionId: string;
	/** Binds metadata to the original accepted MCP result without retaining its text. */
	readonly rawResultDigest: string;
	/** Holds the filename checked against the admitted tool arguments. */
	readonly displayName: string;
	/** Holds the file format admitted for this producer. */
	readonly mediaType: string;
	/** Records the exact UTF-8 file length in bytes. */
	readonly byteLength: number;
}
