// HTTP readers validate this projection beside its shared model before adopting computer state.
// Extra fields are rejected because this public shape must never carry sandbox credentials.
import { z } from "zod";

import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type AgentSandboxConversationComputerRealization, type ComputerLease, type ConversationComputer, type ConversationComputerRealization, type HostDevelopmentConversationComputerRealization } from "./conversation-computer.types";

/** Checks that a server-selected coordinate is nonempty and already normalized. */
function _isCoordinate(value: string): boolean
{
	return !!value.trim() && value === value.trim();
}

/** Requires a server-selected coordinate without accepting whitespace or normalization changes. */
const _Coordinate = z.string().min(1).refine(_isCoordinate);

/** Accepts only an HTTP listener on IPv4 or IPv6 loopback. */
function _isLoopbackEndpoint(value: string): boolean
{
	try
	{
		const endpoint = new URL(value);

		return endpoint.protocol === "http:"
			&& (
				endpoint.hostname === "127.0.0.1"
				|| endpoint.hostname === "[::1]"
			)
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
function _isServiceFQDN(value: string): boolean
{
	return value.length <= 253
		&& value.endsWith(".svc.cluster.local")
		&& value.split(".").every((label) => _isCoordinate(label));
}

/** Requires the loopback endpoint admitted for a host-development realization. */
const _LoopbackEndpoint = z.string().refine(_isLoopbackEndpoint);

/** Requires the in-cluster Service address admitted for an Agent Sandbox realization. */
const _ServiceFQDN = z.string().refine(_isServiceFQDN);

/**
 * Validates the existing logical computer projection, including its identity and lease generation.
 * This structural check grants no authority; callers must also bind conversationId to their request.
 *
 * Called by: HTTP readers, browser event parsing, and durable conversation-computer history parsing.
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
	serviceFQDN: _ServiceFQDN.nullable()
}).strict() satisfies z.ZodType<AgentSandboxConversationComputerRealization>;

/** Validates the loopback host-development realization without granting process authority. */
const _HostDevelopmentConversationComputerRealizationSchema = z.object({
	kind: z.literal(ConversationComputerRealizationKinds.HostDevelopmentProcess),
	processId: _Coordinate,
	endpoint: _LoopbackEndpoint
}).strict() satisfies z.ZodType<HostDevelopmentConversationComputerRealization>;

/**
 * Validates either public conversation-computer realization without accepting unknown variants.
 *
 * Called by: lease validation and consumers that admit realization coordinates independently.
 * @see ConversationComputerRealization
 */
export const ___ConversationComputerRealizationSchema: z.ZodType<ConversationComputerRealization> = z.discriminatedUnion("kind", [
	_AgentSandboxConversationComputerRealizationSchema,
	_HostDevelopmentConversationComputerRealizationSchema
]);

/**
 * Validates a fenced computer lease and its realization without accepting future fields as authority.
 * Temporal ordering and lifecycle compatibility remain the responsibility of the owning history domain.
 *
 * Called by: durable conversation-computer history parsing and external lease readers.
 * @see ComputerLease
 */
export const ___ComputerLeaseSchema: z.ZodType<ComputerLease> = z.object({
	schemaVersion: z.literal(1),
	id: _Coordinate,
	computerId: _Coordinate,
	generation: z.number().int().positive().safe(),
	realization: ___ConversationComputerRealizationSchema,
	state: z.nativeEnum(ComputerLeaseStates),
	claimedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
	releasedAt: z.string().datetime().nullable()
}).strict();
