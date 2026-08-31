/**
 * Validates server responses and deployment configuration before controller code treats them as
 * MCP workload models. The HTTP adapter receives remote JSON and the profile starts as deployment
 * JSON, so these strict schemas keep both untrusted boundaries beside the controller contract.
 */
import { z } from "zod";

import type { McpExecutorJobProfile } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import { RuntimeWorkloadClaimClasses, __IsImmutableRegistryReference } from "@opencrane/backend/agents/runtime/workloads/contract";

import type { McpExecutorControllerClaim, McpExecutorControllerCleanupClaim, McpExecutorControllerReleaseClaim } from "./mcp-executor-controller.types";

/** Rejects control characters in a server-issued coordinate. */
const _CoordinateSchema = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u);

/** Accepts the millisecond UTC format persisted by OpenCrane's database authority. */
const _InstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u).refine(function _ValidInstant(value): boolean { return Number.isFinite(Date.parse(value)); });

/** Accepts an immutable image reference produced by OCI admission. */
const _RegistryReferenceSchema = z.string().refine(function _ImmutableReference(value): boolean { return __IsImmutableRegistryReference(value); });

/** Validates a claim selected by the server rather than the controller. */
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

/** Validates a bounded response that assigns an imported image to a claim. */
const _ClaimResponseSchema = z.object({
	claim: _WorkloadClaimSchema,
	registryReference: _RegistryReferenceSchema,
}).strict();

/** Adds the saved Job UID and release-delivery fence needed before a Job may run. */
const _ReleaseClaimResponseSchema = _ClaimResponseSchema.extend({
	workloadUid: _CoordinateSchema,
	releaseClaimedAt: _InstantSchema,
	releaseDeliveryCount: z.number().int().positive(),
	releaseExpiresAt: _InstantSchema,
}).strict();

/** Adds the saved Job UID and cleanup-delivery fence needed before deletion may be recorded. */
const _CleanupClaimResponseSchema = _ClaimResponseSchema.extend({
	workloadUid: _CoordinateSchema,
	cleanupClaimedAt: _InstantSchema,
	cleanupDeliveryCount: z.number().int().positive(),
}).strict();

/** Bounds CPU and memory requests or limits before they reach the Job builder. */
const _ResourceMapSchema = z.object({
	cpu: z.string().min(1),
	memory: z.string().min(1),
}).strict();

/** Validates the exact Kubernetes resource shape owned by deployment configuration. */
const _ResourcesSchema = z.object({
	requests: _ResourceMapSchema,
	limits: _ResourceMapSchema,
}).strict();

/** Validates the deployment-owned profile before the Job builder applies its policy. */
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

/** Parses the complete assignment claim returned by the internal controller route. */
export function _ParseMcpExecutorControllerClaim(value: unknown): McpExecutorControllerClaim
{
	const result = _ClaimResponseSchema.safeParse(value);
	if (!result.success)
		throw new Error("OpenCrane MCP executor claim was invalid");
	return result.data;
}

/** Parses a release claim with its saved Job UID and current delivery fence. */
export function _ParseMcpExecutorControllerReleaseClaim(value: unknown): McpExecutorControllerReleaseClaim
{
	const result = _ReleaseClaimResponseSchema.safeParse(value);
	if (!result.success)
		throw new Error("OpenCrane MCP executor release claim was invalid");
	return result.data;
}

/** Parses a cleanup claim with its saved Job UID and current delivery fence. */
export function _ParseMcpExecutorControllerCleanupClaim(value: unknown): McpExecutorControllerCleanupClaim
{
	const result = _CleanupClaimResponseSchema.safeParse(value);
	if (!result.success)
		throw new Error("OpenCrane MCP executor cleanup claim was invalid");
	return result.data;
}

/** Parses a one-field route outcome and rejects any unexpected server extension. */
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
