// HTTP readers validate this projection beside its shared model before adopting computer state.
// Extra fields are rejected because this public shape must never carry sandbox credentials.
import { z } from "zod";

import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type AgentSandboxConversationComputerRealization, type ComputerLease, type ConversationComputer, type ConversationComputerRealization, type HostDevelopmentConversationComputerRealization } from "./conversation-computer.types";

/** Requires a server-selected coordinate without accepting empty or whitespace-only values. */
const _Coordinate = z.string().min(1).refine(function _NotBlank(value) { return value.trim().length > 0; });

/** Accepts only an HTTP listener on IPv4 or IPv6 loopback. */
function _IsLoopbackEndpoint(value: string): boolean
{
	try
	{
		const endpoint = new URL(value);
		return endpoint.protocol === "http:"
			&& (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "[::1]")
			&& !endpoint.username
			&& !endpoint.password
			&& endpoint.pathname === "/"
			&& !endpoint.search
			&& !endpoint.hash;
	}
	catch
	{
		return false;
	}
}

/** Accepts one bounded in-cluster Service address without normalizing its durable value. */
function _IsServiceFQDN(value: string): boolean
{
	return value.length <= 253
		&& value.endsWith(".svc.cluster.local")
		&& value.split(".").every(function _ValidLabel(label) { return label.trim().length > 0; });
}

/**
 * Validates the existing logical computer projection, including its identity and lease generation.
 * This structural check grants no authority; callers must also bind conversationId to their request.
 * @see ConversationComputer
 */
export const ___ConversationComputerSchema: z.ZodType<ConversationComputer> = z.object({
	schemaVersion: z.literal(1),
	id: _Coordinate,
	siloId: _Coordinate,
	conversationId: _Coordinate,
	agentIdentityId: _Coordinate,
	profileRevisionId: _Coordinate,
	state: z.nativeEnum(ConversationComputerStates),
	leaseGeneration: z.number().int().nonnegative().safe(),
	workspaceCheckpoint: z.object({ artifactRevisionId: _Coordinate, digest: _Coordinate, format: _Coordinate, checkpointedAt: z.string().datetime() }).strict().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime()
}).strict();

/** Validates the production Agent Sandbox realization without accepting credentials or extra fields. */
const _AgentSandboxConversationComputerRealizationSchema = z.object({
	kind: z.literal(ConversationComputerRealizationKinds.AgentSandbox),
	claimId: _Coordinate,
	sandboxId: _Coordinate.nullable(),
	serviceFQDN: z.string().refine(_IsServiceFQDN).nullable(),
}).strict() satisfies z.ZodType<AgentSandboxConversationComputerRealization>;

/** Validates the loopback host-development realization without granting process authority. */
const _HostDevelopmentConversationComputerRealizationSchema = z.object({
	kind: z.literal(ConversationComputerRealizationKinds.HostDevelopmentProcess),
	processId: _Coordinate,
	endpoint: z.string().refine(_IsLoopbackEndpoint),
}).strict() satisfies z.ZodType<HostDevelopmentConversationComputerRealization>;

/** Validates either public conversation-computer realization without accepting unknown variants. */
export const ___ConversationComputerRealizationSchema: z.ZodType<ConversationComputerRealization> = z.discriminatedUnion("kind", [
	_AgentSandboxConversationComputerRealizationSchema,
	_HostDevelopmentConversationComputerRealizationSchema,
]);

/** Validates a fenced computer lease and its realization. */
export const ___ComputerLeaseSchema: z.ZodType<ComputerLease> = z.object({
	schemaVersion: z.literal(1),
	id: _Coordinate,
	computerId: _Coordinate,
	generation: z.number().int().positive().safe(),
	realization: ___ConversationComputerRealizationSchema,
	state: z.nativeEnum(ComputerLeaseStates),
	claimedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
	releasedAt: z.string().datetime().nullable(),
}).strict();
