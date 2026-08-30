/**
 * Validates the server responses and deployment profile before controller code uses them as MCP
 * workload models. The HTTP adapter receives remote JSON and configuration arrives as JSON, so
 * this module keeps their strict shapes in the one place that both controller entry points use.
 */
import { z } from "zod";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { McpExecutorJobProfile } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";

import type { McpExecutorControllerClaim, McpExecutorControllerReleaseClaim } from "./mcp-executor-controller.types";

/** Rejects control characters in one server-issued coordinate. */
const _CoordinateSchema = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u);

/** Accepts the millisecond UTC format persisted by OpenCrane's database authority. */
const _InstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u).refine(function _ValidInstant(value): boolean { return Number.isFinite(Date.parse(value)); });

/** Accepts only the immutable registry reference created by OCI image import. */
const _RegistryReferenceSchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]*(?:\/[a-z0-9][a-z0-9._/-]*)+@sha256:[a-f0-9]{64}$/u);

/** Validates a claim that the server, rather than a controller, selected. */
const _WorkloadClaimSchema = z.object({
	claimId: _CoordinateSchema,
	siloId: _CoordinateSchema,
	workloadClass: z.literal(RuntimeWorkloadClaimClasses.McpExecutor),
	profileName: _CoordinateSchema.max(128),
	idempotencyKey: _CoordinateSchema,
	claimedAt: _InstantSchema,
	deliveryCount: z.number().int().positive(),
	expiresAt: _InstantSchema,
	executionReference: _CoordinateSchema,
}).strict();

/** Validates one bounded server response that assigns an imported image to a claim. */
const _ClaimResponseSchema = z.object({
	claim: _WorkloadClaimSchema,
	registryReference: _RegistryReferenceSchema,
}).strict();

/** Validates the additional durable fence fields required before an assigned Job can run. */
const _ReleaseClaimResponseSchema = _ClaimResponseSchema.extend({
	workloadUid: _CoordinateSchema,
	releaseClaimedAt: _InstantSchema,
	releaseDeliveryCount: z.number().int().positive(),
	releaseExpiresAt: _InstantSchema,
}).strict();

/** Bounds CPU and memory requests or limits before they reach the pure Job builder. */
const _ResourceMapSchema = z.object({
	cpu: z.string().min(1),
	memory: z.string().min(1),
}).strict();

/** Validates the exact resource shape owned by deployment configuration. */
const _ResourcesSchema = z.object({
	requests: _ResourceMapSchema,
	limits: _ResourceMapSchema,
}).strict();

/** Validates one deployment-owned MCP executor profile before the Job builder applies its policy. */
const _ProfileSchema = z.object({
	companionImage: z.string().min(1),
	imagePullPolicy: z.enum(["Always", "IfNotPresent", "Never"]),
	serverNamespace: z.string().min(1),
	namespace: z.string().min(1),
	serviceAccountName: z.string().min(1),
	opencraneInternalUrl: z.string().min(1),
	projectedTokenTtlSeconds: z.number().int().positive(),
	scratchSize: z.string().min(1),
	activeDeadlineSeconds: z.number().int().positive(),
	serverResources: _ResourcesSchema,
	companionResources: _ResourcesSchema,
}).strict();

/** Parses the complete claim response from the internal controller route. */
export function _ParseMcpExecutorControllerClaim(value: unknown): McpExecutorControllerClaim
{
	const result = _ClaimResponseSchema.safeParse(value);
	if (!result.success)
		throw new Error("OpenCrane MCP executor claim was invalid");
	return result.data;
}

/** Parses the release claim, including the saved Job UID and current release delivery fence. */
export function _ParseMcpExecutorControllerReleaseClaim(value: unknown): McpExecutorControllerReleaseClaim
{
	const result = _ReleaseClaimResponseSchema.safeParse(value);
	if (!result.success)
		throw new Error("OpenCrane MCP executor release claim was invalid");
	return result.data;
}

/** Parses an exact one-field route outcome and rejects any unexpected server extension. */
export function _ParseMcpExecutorControllerOutcome(value: unknown, allowed: readonly string[]): string
{
	const result = z.object({ outcome: z.string().refine(function _Allowed(outcome): boolean { return allowed.includes(outcome); }) }).strict().safeParse(value);
	if (!result.success)
		throw new Error("OpenCrane MCP executor outcome was invalid");
	return result.data.outcome;
}

/** Parses profile JSON into the bounded shape accepted by the MCP Job builder. */
export function _ParseMcpExecutorControllerProfile(value: unknown): McpExecutorJobProfile
{
	const result = _ProfileSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP executor controller profile must contain only its deployment-owned fields");
	return result.data;
}
