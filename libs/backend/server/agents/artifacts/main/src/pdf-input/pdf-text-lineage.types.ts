/** Read-only artifact catalogue boundary used inside a protected conversation transaction. */
export interface ScannedPdfTextRepository
{
	/** Resolves the exact converted text after the caller has authorized its source artifact. */
	resolve(siloId: string, sourceArtifactId: string, sourceRevisionId: string): Promise<ScannedPdfTextLineage | null>;
}

/** Exact published text derived from one clean, current PDF revision. */
export interface ScannedPdfTextLineage
{
	/** Organisation owning both revisions. */
	readonly siloId: string;
	/** Participant-authorized source artifact. */
	readonly sourceArtifactId: string;
	/** Immutable PDF revision that was scanned and converted. */
	readonly sourceRevisionId: string;
	/** Exact source length checked against the conversation asset. */
	readonly sourceByteLength: number;
	/** Hidden artifact holding converted text. */
	readonly artifactId: string;
	/** Exact converted text revision. */
	readonly artifactRevisionId: string;
	/** SHA-256 address of the converted bytes. */
	readonly contentAddress: string;
	/** Exact UTF-8 byte length before any prompt framing. */
	readonly byteLength: number;
	/** Only plain text can be admitted through this boundary. */
	readonly mediaType: "text/plain";
}
