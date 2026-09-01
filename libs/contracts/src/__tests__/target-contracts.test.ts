import { describe, expect, it } from "vitest";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationGrantEffects, AuthorizationSubjectKinds } from "@opencrane/models/authorization";
import { AgentServiceKinds, ConversationLifecycles, ConversationModes, MemoryFactProvenanceSourceKinds } from "../index";
import type { AgentRun, AgentService, AuthorizationGrant, Conversation, RunEvent, SignedFleetMembershipRevision } from "../index";

describe("canonical model exports", function ()
{
  it("keeps a project group grant independent from its hierarchy labels", function ()
  {
    const projectGrant: AuthorizationGrant = {
      grantId: "grant-project",
      siloId: "silo-1",
      subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "user-1" },
      boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "project-cross-functional" },
      boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
      capability: { catalog: { catalogId: "target-capabilities", revision: 1, digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, capabilityId: "artifact.read" },
      resource: { kind: "artifact", id: "artifact-project-brief" },
      effect: AuthorizationGrantEffects.Allow,
      priority: 50,
      validFromEpochMs: 1784365200000,
      expiresAtEpochMs: null,
      revokedAtEpochMs: null,
    };

    expect(projectGrant.boundary).toEqual({ kind: AuthorizationBoundaryKinds.Group, groupId: "project-cross-functional" });
  });

	it("binds services, runs, and events to the target vocabulary", function ()
  {
    const service: AgentService = {
      id: "agent-1",
      siloId: "silo-1",
      kind: AgentServiceKinds.Personal,
      name: "My agent",
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
      conversationId: "conversation-1",
      trigger: "interactive",
		executionSubject: {
			schemaVersion: 1,
			siloId: "silo-1",
			agentIdentityId: "identity-1",
			principalId: "principal-agent-1",
			identity: { agentIdentityId: "identity-1", principalId: "principal-agent-1", siloId: "silo-1", headRevision: "8", headDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
			membership: { principalId: "principal-agent-1", siloId: "silo-1", revision: 21, assertionId: "membership-assertion-1", payloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-09-01T01:00:00.000Z" },
			capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", effectiveContractDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
			runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "agent-1", agentRevisionId: "revision-1" },
			computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 4 },
			requester: { siloId: "silo-1", requesterPrincipalId: "principal-requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" },
			admission: { authorizingPrincipalId: "principal-authorizer-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
		},
      requestIdempotencyKey: "request-1",
      lineage: { rootRunId: "run-1", parentRunId: null },
      attempt: 1,
      state: "waiting_for_input",
      inputSnapshotDigest: "sha256:input",
      acceptedAt: "2026-07-18T09:00:00.000Z",
      startedAt: "2026-07-18T09:00:01.000Z",
      finishedAt: null,
      terminalReason: null,
    };
		const event: RunEvent = { runId: run.id, attempt: run.attempt, sequence: 4, type: "elicitation.requested", payload: { requestId: "elicitation-1" }, occurredAt: "2026-07-18T09:00:02.000Z" };

		expect(event.runId).toBe(run.id);
    expect(run.agentServiceId).toBe(service.id);
  });

  it("re-exports the canonical immutable-mode conversation model", function ()
  {
    const conversation: Conversation = {
      id: "conversation-1",
      siloId: "silo-1",
      mode: ConversationModes.AgentSession,
      lifecycle: ConversationLifecycles.Open,
      agentServiceId: "agent-1",
      contextRevisionId: null,
      closedAt: null,
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z",
    };

    expect(conversation.mode).toBe("agent_session");
  });

  it("preserves serialized agent, identity, and memory provenance discriminants", function ()
  {
    expect([AgentServiceKinds.Personal, AgentServiceKinds.Managed]).toEqual(["personal", "managed"]);
    expect([MemoryFactProvenanceSourceKinds.Message, MemoryFactProvenanceSourceKinds.Artifact, MemoryFactProvenanceSourceKinds.ExplicitUserFact]).toEqual(["message", "artifact", "explicit-user-fact"]);
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
      assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" }],
    };

    expect(signedRevision.revision).toBeGreaterThan(0);
    expect(signedRevision.assertions[0]?.subjectId).toBe("user-1");
  });

});
