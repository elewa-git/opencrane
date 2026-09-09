import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ManagedConversationExecutionSubjectAuthority } from "../managed-conversation-execution-subject-authority";
import type { PersonalConversationExecutionSubjectCoordinates } from "../personal-conversation-execution-subject-authority.types";

const _NOW = "2026-09-06T01:00:00.000Z";
const _IDENTITY = { schemaVersion: 1, id: "identity-1", siloId: "silo-1", agentServiceId: "service-1", name: "Company", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: "principal-1", createdAt: _NOW, kind: "managed", principalId: "company-principal" } as const;

/** Supplies every immutable coordinate captured by app composition. */
function _Coordinates(overrides: Partial<PersonalConversationExecutionSubjectCoordinates> = {}): PersonalConversationExecutionSubjectCoordinates
{
	return { runId: "run-1", computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, agent: { agentServiceId: "service-1", agentRevisionId: "revision-1", profileRevisionId: "profile-1" }, lease: { leaseId: "lease-1", leaseGeneration: 3, sandboxClaimId: "claim-1" }, requesterPrincipalId: "principal-1", requesterIssuer: "issuer-1", requesterSubjectId: "subject-1", requesterAuthenticatedAt: _NOW, requestIdempotencyKey: "request-1", ...overrides };
}

/** Builds the transaction-facing admission command without computer-owned fields. */
function _Command()
{
	return { runId: "run-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", requestIdempotencyKey: "request-1", messageInput: null, trigger: "interactive" as const, requester: { issuer: "issuer-1", subjectId: "subject-1", authenticatedAt: _NOW } };
}

/** Builds all three authorities with exact durable evidence identifiers. */
function _Dependencies(coordinates: PersonalConversationExecutionSubjectCoordinates = _Coordinates())
{
	const identityHistory = { loadActive: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 4n, headEventId: "identity-event-4", headDigest: "sha256:identity-head", identity: _IDENTITY }) };
	const executionEvidence = { load: vi.fn().mockResolvedValue({ outcome: "loaded", value: { membership: { kind: "managed", principalId: "company-principal", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: "sha256:revision", decisionEvidenceId: "sha256:model", trustedUntil: "2099-01-01T00:00:00.000Z" }, requesterMembership: { kind: "fleet", principalId: "principal-1", siloId: "silo-1", revision: 7, assertionId: "assertion-7", payloadDigest: "sha256:membership", decisionEvidenceId: "assertion-7", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { effectiveContractDigest: "sha256:contract", effectiveBoundaryAttachments: [], effectiveBoundaryAttachmentDigest: "sha256:capability", authorizationDecisionDigests: ["sha256:admission"] }, admissionDecisionDigest: "sha256:admission" } }) };
	const computerHistory = { loadActiveLease: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 5n, computer: { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 4, workspaceCheckpoint: null, createdAt: _NOW, updatedAt: _NOW }, lease: { schemaVersion: 1, id: "lease-1", computerId: "computer-1", generation: 3, sandboxClaimId: "claim-1", sandboxId: "sandbox-1", serviceFQDN: "sandbox.local", state: ComputerLeaseStates.Active, claimedAt: _NOW, expiresAt: "2099-01-01T00:00:00.000Z", releasedAt: null } }) };
	return { resolvePrincipalId: vi.fn().mockResolvedValue("company-principal"), coordinates, identityHistory, executionEvidence, executionEvidenceFactory: vi.fn().mockReturnValue(executionEvidence), computerHistory };
}

describe("ManagedConversationExecutionSubjectAuthority", function _Suite()
{
	it("joins checked history and transaction evidence into the exact attempt-one subject", async function _LoadsSubject()
	{
		const dependencies = _Dependencies();
		const authority = new ManagedConversationExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory } as never);
		const result = await authority.load(_Command(), { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never);
		expect(result).toMatchObject({ outcome: "loaded", value: { identity: { headRevision: "4", headDigest: "sha256:identity-head", decisionEvidenceId: "identity-event-4" }, principalId: "company-principal", membership: { kind: "managed", decisionEvidenceId: "sha256:model" }, requester: { requesterPrincipalId: "principal-1", membership: { kind: "fleet", principalId: "principal-1" } }, capability: { capabilitySetDigest: "sha256:capability", decisionEvidenceId: "sha256:model" }, runScope: { runId: "run-1", attempt: 1 }, computerScope: { leaseId: "lease-1", leaseGeneration: 3 }, admission: { decisionEvidenceId: "sha256:admission" } } });
		expect(dependencies.executionEvidence.load).toHaveBeenCalledWith(expect.objectContaining({ requesterPrincipalId: "principal-1", agentRevisionId: "revision-1" }), expect.objectContaining({ admittedAtEpochMs: Date.parse(_NOW) }));
	});

	it("fails before history reads when an app-bound requester coordinate changes", async function _RejectsCommandDrift()
	{
		const dependencies = _Dependencies(_Coordinates({ requesterIssuer: "issuer-other" }));
		const authority = new ManagedConversationExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory } as never);
		await expect(authority.load(_Command(), { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(dependencies.identityHistory.loadActive).not.toHaveBeenCalled();
	});

	it("fails closed when the active lease does not match the exact SandboxClaim", async function _RejectsLeaseDrift()
	{
		const dependencies = _Dependencies(_Coordinates({ lease: { leaseId: "lease-1", leaseGeneration: 3, sandboxClaimId: "claim-other" } }));
		const authority = new ManagedConversationExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory } as never);
		await expect(authority.load(_Command(), { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
	});
	it("rejects a requester Principal substituted for the company Principal before reading identity history", async function _RejectsBorrowedHuman()
	{
		const dependencies = _Dependencies();
		dependencies.resolvePrincipalId.mockResolvedValue("principal-1");
		const authority = new ManagedConversationExecutionSubjectAuthority({ ...dependencies, executionEvidence: dependencies.executionEvidenceFactory } as never);
		await expect(authority.load(_Command(), { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never, { prisma: {}, authorization: {}, admittedAt: _NOW, admittedAtEpochMs: Date.parse(_NOW) } as never)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(dependencies.identityHistory.loadActive).not.toHaveBeenCalled();
	});

});
