/** Cognee document fields returned in a locked Cognify input snapshot. */
export interface CogneeCognifyEvidenceDocumentWire
{
	/** Provider Data UUID. */
	readonly id: string;
	/** Provider document name. */
	readonly name: string;
	/** Provider creation time. */
	readonly createdAt: string;
	/** Provider update time when the document changed. */
	readonly updatedAt: string | null;
	/** Stored file extension. */
	readonly extension: string;
	/** Stored media type. */
	readonly mimeType: string;
	/** Private provider storage path, which the adapter discards. */
	readonly rawDataLocation: string;
	/** Dataset UUID set by the provider route. */
	readonly datasetId: string;
	/** Optional provider label, which the adapter discards. */
	readonly label: string | null;
	/** Optional provider metadata, which the adapter discards. */
	readonly externalMetadata: Readonly<Record<string, unknown>> | null;
	/** SHA-256 digest of the complete raw document bytes under the provider lock. */
	readonly contentDigest: string;
	/** Number of raw bytes covered by the content digest. */
	readonly byteLength: number;
}

/** Cognee response that binds document evidence under the dataset lock. */
export interface CogneeCognifyInputEvidenceWire
{
	/** Dataset UUID whose locked membership was read. */
	readonly datasetId: string;
	/** Digest that binds the complete locked document snapshot. */
	readonly inputEvidenceDigest: string;
	/** Documents included in the snapshot. */
	readonly data: readonly CogneeCognifyEvidenceDocumentWire[];
}

/** Fields returned for one completed Cognee pipeline run. */
export interface CogneePipelineRunWire
{
	/** Provider pipeline status. */
	readonly status: string;
	/** Provider pipeline run UUID. */
	readonly pipeline_run_id: string;
	/** Dataset UUID processed by this run. */
	readonly dataset_id: string;
	/** Provider dataset name, which the adapter discards. */
	readonly dataset_name: string;
	/** Caller-saved indexing operation UUID. */
	readonly operation_id: string;
	/** Locked input digest processed by this run. */
	readonly input_evidence_digest: string;
	/** Provider payload, when supplied; the adapter discards it. */
	readonly payload?: unknown;
	/** Provider ingestion details, which the adapter discards. */
	readonly data_ingestion_info: readonly unknown[] | null;
}
