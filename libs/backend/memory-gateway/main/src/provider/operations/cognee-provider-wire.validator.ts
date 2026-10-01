import { z, type ZodType } from "zod";

import { MEMORY_GATEWAY_LIMITS } from "@opencrane/contracts";

import type { CogneeCognifyEvidenceDocumentWire, CogneeCognifyInputEvidenceWire, CogneeDatasetWire, CogneePipelineRunWire } from "./cognee-provider-wire.types";

/** Provider timestamps must contain a complete date, time, and offset. */
const _DateTimeSchema = z.string().datetime({ offset: true });

/** Strict DatasetDTO response from the pinned provider. */
export const _CogneeDatasetWireSchema: ZodType<CogneeDatasetWire> = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(MEMORY_GATEWAY_LIMITS.DatasetNameMaximumCharacters),
	createdAt: _DateTimeSchema,
	updatedAt: _DateTimeSchema.nullable(),
	ownerId: z.string().uuid(),
}).strict();

/** SHA-256 format returned by the repaired provider. */
const _DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Terminal status required before the gateway issues a Cognify receipt. */
export const _COGNEE_PIPELINE_COMPLETED_STATUS = "PipelineRunCompleted";

/** Cognee Data transfer object extended with locked input evidence. */
export const _CogneeCognifyEvidenceDocumentWireSchema: ZodType<CogneeCognifyEvidenceDocumentWire> = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(MEMORY_GATEWAY_LIMITS.DocumentNameMaximumCharacters),
	createdAt: _DateTimeSchema,
	updatedAt: _DateTimeSchema.nullable(),
	extension: z.string().max(32),
	mimeType: z.string().min(1).max(MEMORY_GATEWAY_LIMITS.MimeTypeMaximumCharacters),
	rawDataLocation: z.string().min(1).max(4_096),
	datasetId: z.string().uuid(),
	label: z.string().max(255).nullable(),
	externalMetadata: z.record(z.string(), z.unknown()).nullable(),
	contentDigest: _DigestSchema,
	byteLength: z.number().int().min(0).max(MEMORY_GATEWAY_LIMITS.TextMaximumBytes),
}).strict();

/** Locked Cognee input evidence returned by the repaired dataset route. */
export const _CogneeCognifyInputEvidenceWireSchema: ZodType<CogneeCognifyInputEvidenceWire> = z.object({
	datasetId: z.string().uuid(),
	inputEvidenceDigest: _DigestSchema,
	data: z.array(_CogneeCognifyEvidenceDocumentWireSchema).max(MEMORY_GATEWAY_LIMITS.DocumentResultsMaximum),
}).strict();

/** Completed pipeline fields returned by the repaired blocking Cognify route. */
export const _CogneePipelineRunWireSchema: ZodType<CogneePipelineRunWire> = z.object({
	status: z.literal(_COGNEE_PIPELINE_COMPLETED_STATUS),
	pipeline_run_id: z.string().uuid(),
	dataset_id: z.string().uuid(),
	dataset_name: z.string().min(1).max(MEMORY_GATEWAY_LIMITS.DatasetNameMaximumCharacters),
	operation_id: z.string().uuid(),
	input_evidence_digest: _DigestSchema,
	payload: z.unknown(),
	data_ingestion_info: z.array(z.unknown()).nullable(),
}).strict();
