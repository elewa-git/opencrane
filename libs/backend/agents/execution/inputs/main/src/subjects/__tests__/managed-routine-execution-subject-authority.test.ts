import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { ManagedRoutineExecutionSubjectAuthority } from "../managed-routine-execution-subject-authority";
import type { ManagedRoutineExecutionSubjectCoordinates } from "../managed-routine-execution-subject-authority.types";

const _NOW = "2026-09-06T01:00:00.000Z";
const _APPROVED_AT = "2026-08-20T09:00:00.000Z";
const _IDENTITY = { schemaVersion: 1, id: "identity-1", siloId: "silo-1", agentServiceId: "service-1", name: "Company", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "principal-1", createdAt: _NOW, kind: "managed", principalId: "company-principal" } as const;

/** Stored routine command assembled by the scheduling authority. */
function _Command(trigger: "scheduled" | "manual" = "scheduled")
{
	return { runId: "run-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", requestIdempotencyKey: "firing-1", messageInput: null, trigger, routineInput: { routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot: trigger === "scheduled" ? "2026-09-06T02:00:00.000Z" : null, requesterPrincipalId: "principal-1", requesterIssuer: "issuer-1", requesterSubjectId: "subject-1", requesterAuthenticatedAt: _APPROVED_AT, workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" } };
}

/** Product-owned occurrence and computer coordinates captured before admission. */
function _Coordinates(command = _Command()): ManagedRoutineExecutionSubjectCoordinates
{
	return { runId: command.runId, computer: { siloId: command.siloId, conversationId: command.conversationId, computerId: "computer-1", agentIdentityId: "identity-1" }, agent: { agentServiceId: command.agentServiceId, agentRevisionId: "revision-1", profileRevisionId: "profile-1" }, lease: { leaseId: "lease-1", leaseGeneration: 3, sandboxClaimId: "claim-1" }, requestIdempotencyKey: command.requestIdempotencyKey, routine: command.routineInput };
}

/** Current identity, lease, agent permission, and requester membership evidence. */
function _Dependencies(command = _Command())
{
	const identityHistory = { loadActive: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 4n, headEventId: "identity-event-4", headDigest: "sha256:identity-head", identity: _IDENTITY }) };
	const executionEvidence = { load: vi.fn().mockResolvedValue({ outcome: "loaded", value: { membership: { kind: "managed", principalId: "company-principal", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: "sha256:revision", decisionEvidenceId: "sha256:model", trustedUntil: "2099-01-01T00:00:00.000Z" }, requesterMembership: { kind: "fleet", principalId: "principal-1", siloId: "silo-1", revision: 7, assertionId: "assertion-7", payloadDigest: "sha256:membership", decisionEvidenceId: "assertion-7", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { effectiveContractDigest: "sha256:contract", effectiveBoundaryAttachments: [], effectiveBoundaryAttachmentDigest: "sha256:capability", authorizationDecisionDigests: ["sha256:admission"] }, admissionDecisionDigest: "sha256:admission" } }) };
	const computerHistory = { loadActiveLease: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 5n, computer: { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 4, workspaceCheckpoint: null, createdAt: _NOW, updatedAt: _NOW }, lease: { schemaVersion: 1, id: "lease-1", computerId: "computer-1", generation: 3, sandboxClaimId: "claim-1", sandboxId: "sandbox-1", serviceFQDN: "sandbox.local", state: ComputerLeaseStates.Active, claimedAt: _NOW, expiresAt: "2099-01-01T00:00:00.000Z", releasedAt: null } }) };
	return { coordinates: _Coordinates(command), resolvePrincipalId: vi.fn().mockResolvedValue("company-principal"), identityHistory, executionEvidence, executionEvidenceFactory: vi.fn().mockReturnValue(executionEvidence), computerHistory };
}

describe("ManagedRoutineExecutionSubjectAuthority", function _Suite()
{
	it("reports failed authority reads while refusing admission and excluding instruction content", async function _ReportsReadFailure()
	{
		const dependencies = _Dependencies();
		const err = new Error("history store unavailable");
		dependencies.identityHistory.loadActive.mockRejectedValue(err);
		const log = { warn: vi.fn() };
		const authority = new ManagedRoutineExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory }, log);
		const result = await authority.load(_Command(), { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never);
		expect(result).toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(log.warn).toHaveBeenCalledExactlyOnceWith({ err, siloId: "silo-1", runId: "run-1", agentServiceId: "service-1" }, "Routine identity or computer authority could not be read");
		expect(dependencies.executionEvidence.load).not.toHaveBeenCalled();
	});

	it("uses the managed Principal and preserves original approval authentication as requester provenance", async function _LoadsRoutineSubject()
	{
		const dependencies = _Dependencies();
		const authority = new ManagedRoutineExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory });
		const result = await authority.load(_Command(), { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never);
		expect(result).toMatchObject({ outcome: "loaded", value: { principalId: "company-principal", requester: { requesterPrincipalId: "principal-1", authenticatedAt: _APPROVED_AT }, runScope: { runId: "run-1", attempt: 1 }, computerScope: { leaseId: "lease-1", leaseGeneration: 3 } } });
		expect(dependencies.executionEvidence.load).toHaveBeenCalledWith(expect.objectContaining({ requesterPrincipalId: "principal-1", agentRevisionId: "revision-1", routineTrigger: RoutineFiringTrigger.Automatic }), expect.objectContaining({ admittedAtEpochMs: Date.parse(_NOW) }));
	});

	it("maps a verified manual command to the manual routine audit trigger", async function _LoadsManualRoutineActor()
	{
		const command = _Command("manual");
		const dependencies = _Dependencies(command);
		const authority = new ManagedRoutineExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory });

		await expect(authority.load(command, { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never)).resolves.toMatchObject({ outcome: "loaded" });
		expect(dependencies.executionEvidence.load).toHaveBeenCalledWith(expect.objectContaining({ routineTrigger: RoutineFiringTrigger.Manual }), expect.any(Object));
	});

	it("rejects substituted firing coordinates before reading current identity", async function _RejectsFiringDrift()
	{
		const dependencies = _Dependencies();
		const authority = new ManagedRoutineExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory });
		const command = { ..._Command(), routineInput: { ..._Command().routineInput, firingId: "firing-other" } };
		await expect(authority.load(command, { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(dependencies.identityHistory.loadActive).not.toHaveBeenCalled();
	});

	it("rejects interactive commands instead of borrowing the current browser session", async function _RejectsInteractive()
	{
		const dependencies = _Dependencies();
		const authority = new ManagedRoutineExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory });
		const interactive = { runId: "run-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", requestIdempotencyKey: "message-1", messageInput: null, trigger: "interactive" as const, requester: { issuer: "issuer-current", subjectId: "subject-current", authenticatedAt: _NOW } };
		await expect(authority.load(interactive, { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(dependencies.identityHistory.loadActive).not.toHaveBeenCalled();
	});
});
