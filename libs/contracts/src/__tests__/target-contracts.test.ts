import { describe, expect, it } from "vitest";
import { ApprovalStatus } from "../index.js";
import type { AgentRun, AgentService, Approval, AuthorizationGrant, PersonaRevision, PlatformPolicy, RunEvent, SignedFleetMembershipRevision } from "../index.js";

describe("canonical model exports", function ()
{
  it("keeps project membership independent from department and team", function ()
  {
    const projectGrant: AuthorizationGrant = {
      grantId: "grant-project",
      siloId: "silo-1",
      subjectId: "user-1",
      scope: { kind: "project", organizationId: "org-1", projectId: "project-cross-functional" },
      capability: { catalog: { catalogId: "target-capabilities", revision: 1, digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, capabilityId: "artifact.read" },
      resource: { kind: "artifact", id: "artifact-project-brief" },
      effect: "allow",
      priority: 50,
      validFromEpochMs: 1784365200000,
      expiresAtEpochMs: null,
      revokedAtEpochMs: null,
    };

    expect(projectGrant.scope).toEqual({ kind: "project", organizationId: "org-1", projectId: "project-cross-functional" });
  });

  it("exports the approved first-persona gate without a mutable runtime file", function ()
  {
    const persona: PersonaRevision = {
      id: "persona-1",
      personaProfileId: "profile-1",
      revision: 1,
      state: "approved",
      soulTemplate: { id: "structured-collaborator", version: 2, digest: "sha256:soul" },
      interviewId: "interview-1",
      insights: [
        { id: "insight-1", category: "answer_structure", statement: "Prefer concise options before detail.", provenance: { interviewId: "interview-1", questionSetId: "personal-agent-onboarding", questionSetVersion: 1, questionId: "communication-style", answerId: "answer-1" } },
        { id: "insight-2", category: "approval_risk", statement: "Ask before sharing outside the project.", provenance: { interviewId: "interview-1", questionSetId: "personal-agent-onboarding", questionSetVersion: 1, questionId: "privacy-boundary", answerId: "answer-2" } },
        { id: "insight-3", category: "working_habits", statement: "Track decisions explicitly.", provenance: { interviewId: "interview-1", questionSetId: "personal-agent-onboarding", questionSetVersion: 1, questionId: "working-style", answerId: "answer-3" } },
      ],
      compiledInstructions: "# Working agreement",
      previousRevisionId: null,
      authoredBy: "user-1",
      createdAt: "2026-07-18T09:00:00.000Z",
      approvedBy: "user-1",
      approvedAt: "2026-07-18T09:01:00.000Z",
      durableSoulMutationPolicy: "forbidden",
    };

    expect(persona.insights).toHaveLength(3);
    expect(persona.durableSoulMutationPolicy).toBe("forbidden");
  });

  it("binds services, runs, events, and approvals to the target vocabulary", function ()
  {
    const service: AgentService = {
      id: "agent-1",
      siloId: "silo-1",
      kind: "personal",
      name: "My agent",
      owner: { scope: "personal", subjectId: "user-1" },
      state: "active",
      activeRevisionId: "revision-1",
      workloadProfile: "personal-agent",
      createdAt: "2026-07-18T09:00:00.000Z",
      updatedAt: "2026-07-18T09:00:00.000Z",
    };
    const run: AgentRun = {
      id: "run-1",
      siloId: "silo-1",
      agentServiceId: service.id,
      agentRevisionId: "revision-1",
      threadId: "thread-1",
      trigger: "interactive",
      delegatedUserId: "user-1",
      executionSubjectId: "user-1",
      requestIdempotencyKey: "request-1",
      lineage: { rootRunId: "run-1", parentRunId: null },
      attempt: 1,
      state: "waiting_for_approval",
      effectiveContractDigest: "sha256:contract",
      inputSnapshotDigest: "sha256:input",
      acceptedAt: "2026-07-18T09:00:00.000Z",
      startedAt: "2026-07-18T09:00:01.000Z",
      finishedAt: null,
      terminalReason: null,
    };
    const event: RunEvent = { runId: run.id, sequence: 4, type: "tool.approval_required", payload: { approvalId: "approval-1" }, occurredAt: "2026-07-18T09:00:02.000Z" };
    const approval: Approval = { id: "approval-1", runId: run.id, capabilityKey: "email.send", actionDigest: "sha256:action", status: ApprovalStatus.Pending, decisionOwnerUserId: "user-1", expiresAt: "2026-07-18T09:05:00.000Z" };

    expect(event.runId).toBe(approval.runId);
    expect(run.agentServiceId).toBe(service.id);
  });
});
describe("canonical fleet and platform exports", function ()
{
  it("carries a monotonic signed fleet-membership revision", function ()
  {
    const signedRevision: SignedFleetMembershipRevision = {
      revision: 42,
      issuerId: "opencrane-fleet",
      issuerKeyId: "fleet-membership-2026-01",
      siloId: "silo-1",
      issuedAtEpochMs: 1784365200000,
      expiresAtEpochMs: 1784365500000,
      payloadDigest: "sha256:membership",
      signature: "base64url-signature",
      assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1", scope: { kind: "project", organizationId: "org-1", projectId: "project-1" } }],
    };

    expect(signedRevision.revision).toBeGreaterThan(0);
    expect(signedRevision.assertions[0]?.scope.kind).toBe("project");
  });

  it("requires durable mounts, ephemeral runtime scratch, and sub-five-minute updates", function ()
  {
    const policy: PlatformPolicy = {
      durableState: { retention: "until-authorized-deletion", storage: "persistent", expansion: "online", alertBeforeExhaustion: true, expandBeforeExhaustion: true, backup: "required" },
      runtimeFilesystem: { rootAuthority: "non-authoritative", rootAccess: "read-only-when-supported", workspaceAuthority: "non-authoritative-scratch", workspaceLifetime: "lease-scoped", workspaceBackup: "never", clearWorkspaceOn: ["replacement", "scale-zero", "lease-expiry"] },
      siloUpdate: { maximumDurationExclusiveMs: 300000, volumeHandling: "remount-existing", stateHandling: "resume-canonical", predecessorRuntime: "forbidden", predecessorDataTransformation: "forbidden" },
    };

    expect(policy.durableState.expansion).toBe("online");
    expect(policy.runtimeFilesystem.workspaceBackup).toBe("never");
    expect(policy.siloUpdate.maximumDurationExclusiveMs).toBe(300000);
  });
});
