import type { Prisma } from "@prisma/client";

/** Locked Prisma service row shape consumed by the mapper. */
export interface AgentServiceRow
{
	readonly id: string;
	readonly siloId: string;
	readonly kind: string;
	readonly name: string;
	readonly state: string;
	readonly activeRevisionId: string | null;
	readonly workloadProfile: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** Locked Prisma revision row shape, with its immutable assignments and attachments. */
export interface AgentRevisionRow
{
	readonly id: string;
	readonly agentServiceId: string;
	readonly revision: number;
	readonly parentRevisionId: string | null;
	readonly sourceRevisionId: string | null;
	readonly changeMessage: string;
	readonly state: string;
	readonly digest: string;
	readonly promptPolicyVersion: string;
	readonly personaRevisionId: string | null;
	readonly modelDefinitionId: string;
	readonly budget: Prisma.JsonValue;
	readonly authoredBy: string;
	readonly createdAt: Date;
	readonly publishedAt: Date | null;
	readonly skillAssignments: ReadonlyArray<{ skillId: string; skillRevisionId: string }>;
	readonly integrationAssignments: ReadonlyArray<{ integrationId: string; custodyReferenceId: string; toolDefinitions: Prisma.JsonValue }>;
	readonly mcpToolAssignments: ReadonlyArray<{ toolRevisionId: string }>;
	readonly boundaryAttachments: ReadonlyArray<{ boundaryKind: string; boundaryGroupId: string | null; boundaryPrincipalId: string | null; boundaryCoverage: string }>;
}

/** Locked Prisma run row shape consumed by the run-history mapper. */
export interface AgentRunRow
{
	readonly id: string;
	readonly siloId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly conversationId: string | null;
	readonly trigger: string;
	readonly delegatedUserId: string | null;
	readonly requestIdempotencyKey: string;
	readonly rootRunId: string;
	readonly parentRunId: string | null;
	readonly attempt: number;
	readonly state: string;
	readonly effectiveContractDigest: string;
	readonly inputSnapshotDigest: string;
	readonly acceptedAt: Date;
	readonly startedAt: Date | null;
	readonly finishedAt: Date | null;
	readonly terminalReason: string | null;
}
