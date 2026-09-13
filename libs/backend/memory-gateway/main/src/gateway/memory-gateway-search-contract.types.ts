/** Canonical provider request together with the exact admitted dataset coordinate. */
export interface ValidatedMemorySearch
{
	/** Canonical JSON bytes sent through the authenticated provider session. */
	readonly body: Uint8Array;
	/** Lowercase dataset UUID used to verify the provider response envelope. */
	readonly datasetId: string;
}
