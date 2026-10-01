// These schemas are the trust boundary between public HTTP JSON and the named fixture projections;
// they strip unrelated API fields so each projection changes only with its adjacent TypeScript model.
import { z } from "zod";

import type { HostedGeneratedFileAsset, HostedGeneratedFileOciValidation, HostedGeneratedFileRun, HostedGeneratedFileToolSelection } from "./hosted-generated-file.types";

/** Runtime schema for the selected browser-safe asset projection. */
const _AssetSchema: z.ZodType<HostedGeneratedFileAsset> = z.object({
	id: z.string().min(1),
	artifactId: z.string().min(1).nullable(),
	artifactRevisionId: z.string().min(1).nullable(),
	byteLength: z.number().int().nonnegative().nullable(),
	displayName: z.string().min(1),
	mediaType: z.string().min(1),
	messageId: z.string().min(1).nullable(),
	provenance: z.string().min(1),
	state: z.string().min(1),
}).strip();

/** Runtime schema for immutable OCI validation evidence. */
const _OciValidationSchema: z.ZodType<HostedGeneratedFileOciValidation> = z.object({
	id: z.string().min(1),
	artifactId: z.string().min(1),
	artifactRevisionId: z.string().min(1),
	byteLength: z.number().int().nonnegative(),
	configDigest: z.string().min(1).nullable(),
	contentAddress: z.string().min(1),
	imageManifestDigest: z.string().min(1).nullable(),
	indexDigest: z.string().min(1).nullable(),
	mediaType: z.string().min(1),
	registryReference: z.string().min(1).nullable(),
	state: z.string().min(1),
}).strip();

/** Runtime schema for one public run projection. */
const _RunSchema: z.ZodType<HostedGeneratedFileRun> = z.object({
	runId: z.string().min(1),
	attempt: z.number().int().nonnegative(),
	state: z.string().min(1),
	conversationId: z.string().min(1).nullable(),
	agentRevisionId: z.string().min(1),
	finishedAt: z.string().min(1).nullable(),
}).strip();

/** Runtime schema for the public personal-agent tool selection. */
const _ToolSelectionSchema: z.ZodType<HostedGeneratedFileToolSelection> = z.object({
	agentServiceId: z.string().min(1),
	activeRevisionId: z.string().min(1),
	toolRevisionIds: z.array(z.string().min(1)),
}).strip();

/** Parse one public asset and strip fields outside the fixture projection. */
export function __ParseHostedGeneratedFileAsset(value: unknown): HostedGeneratedFileAsset
{
	return _AssetSchema.parse(value);
}

/** Parse one public OCI validation and strip fields outside the fixture projection. */
export function __ParseHostedGeneratedFileOciValidation(value: unknown): HostedGeneratedFileOciValidation
{
	return _OciValidationSchema.parse(value);
}

/** Parse one public run and strip fields outside the fixture projection. */
export function __ParseHostedGeneratedFileRun(value: unknown): HostedGeneratedFileRun
{
	return _RunSchema.parse(value);
}

/** Parse one public personal tool selection and strip fields outside the fixture projection. */
export function __ParseHostedGeneratedFileToolSelection(value: unknown): HostedGeneratedFileToolSelection
{
	return _ToolSelectionSchema.parse(value);
}
