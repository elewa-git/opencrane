import express from "express";
import request from "supertest";
import {
  ComputerLeaseStates,
  ConversationComputerStates,
} from "@opencrane/contracts";
import {
  BoundConversationWriter,
  ConversationComputerActivationAuthorityAdapter,
  ConversationComputerHistory,
  ConversationComputerTurnAuthorityService,
  _CreateConversationComputerTurnRouter,
} from "@opencrane/backend/server/conversations";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("conversation computer turn integration", function _Suite() {
  afterEach(function _Restore() {
    vi.restoreAllMocks();
  });
  it("flows from activation claim through model output to one assistant append", async function _Turn() {
    const computer = {
      schemaVersion: 1 as const,
      id: "computer-one",
      siloId: "testv5",
      conversationId: "conversation-one",
      agentIdentityId: "identity-one",
      profileRevisionId: `sha256:${"a".repeat(64)}`,
      state: ConversationComputerStates.ClaimPending,
      leaseGeneration: 1,
      workspaceCheckpoint: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    const lease = {
      schemaVersion: 1 as const,
      id: "lease-one",
      computerId: computer.id,
      generation: 1,
      sandboxClaimId: "computer-one-g1",
      sandboxId: null,
      serviceFQDN: null,
      state: ComputerLeaseStates.Claimed,
      claimedAt: "2026-09-05T00:00:00.000Z",
      expiresAt: "2099-09-05T00:00:00.000Z",
      releasedAt: null,
    };
    vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValue({
      streamName: "conversation-computer-computer-one",
      revision: 1n,
      computer,
      lease,
    });
    vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue(
      { streamName: "conversation-computer-computer-one", revision: 2n },
    );
    const activation = new ConversationComputerActivationAuthorityAdapter(
      {
        resolve: vi
          .fn()
          .mockResolvedValue({
            agentIdentityId: computer.agentIdentityId,
            profileRevisionId: computer.profileRevisionId,
          }),
        publishActiveLease: vi.fn().mockResolvedValue(undefined),
      },
      {} as never,
      {
        claim: vi
          .fn()
          .mockResolvedValue({
            claimId: "computer-one-g1",
            outcome: "existing",
            sandboxId: "sandbox-one",
            serviceFQDN: "sandbox-one.testv5.svc.cluster.local",
          }),
      } as never,
      {
        profileRevisionId: computer.profileRevisionId,
        profileName: "developer",
        warmPoolName: "pool",
        namespace: "testv5",
        leaseTtlMilliseconds: 60_000,
      },
    );
    await expect(
      activation.activate({
        siloId: "testv5",
        computerId: computer.id,
        conversationId: computer.conversationId,
        generation: 1,
      }),
    ).resolves.toBe("activated");

    let frozen: any = null;
    const append = vi.fn().mockResolvedValue({});
    const authority = new ConversationComputerTurnAuthorityService({
      toolProposals: { admit: vi.fn() },
		siloId: "testv5",
		runLifecycle: { start: vi.fn(), complete: vi.fn() },
      candidates: {
        resolve: vi
          .fn()
          .mockResolvedValue({
            binding: {
              siloId: "testv5",
              conversationId: computer.conversationId,
              computerId: computer.id,
              leaseGeneration: 1,
              agentIdentityId: computer.agentIdentityId,
              agentServiceId: "service-one",
              agentName: "Ada",
              agentAvatarArtifactRevisionId: null,
              runId: "run-one",
              expectedRevision: 1n,
              maximumEntryBytes: 65_536,
            },
            compiledInput: {
              promptCompilerVersion: "v1",
              runId: "run-one",
              attempt: 1,
              instructions: "help",
              messages: [{ role: "user", content: "hello" }],
              tools: [],
              model: {
                modelAlias: "model-one",
                maxOutputTokens: null,
                generatedOutputCapabilities: [],
              },
              budget: {
                maxModelTurns: 1,
                maxCompletionTokens: 100,
                maxCostUsdMicros: 100_000,
                maxToolInvocations: 0,
                wallClockDeadlineEpochMs: null,
              },
              digest: `sha256:${"b".repeat(64)}`,
            },
            latestPendingEntryId: "entry-one",
            modelAlias: "model-one",
            maximumBudgetUsd: 0.1,
            credentialLifetimeSeconds: 300,
            lease: { leaseId: "lease-one", leaseGeneration: 1, sandboxClaimId: "computer-one-g1" },
          }),
        assertCurrent: vi.fn(),
        admit: vi.fn(),
      },
      reviewCredentials: { bearer: vi.fn(), derive: vi.fn().mockReturnValue("keyed-review-secret") },
      credentials: {
        issueOrRotate: vi
          .fn()
          .mockResolvedValue({
            key: "sk-turn",
            credentialDigest: "sha256:key",
          }),
        revoke: vi.fn(),
      },
      endpoint: "http://model.stub",
      outputPayloads: {
        store: vi
          .fn()
          .mockResolvedValue({
            blockId: "block-one",
            payloadRef: "payload-one",
            ciphertextDigest: "sha256:cipher",
          }),
      },
      store: {
        reserveTool: vi.fn().mockResolvedValue(undefined),
        createOrRead: vi.fn(async (turn) => (frozen ??= turn)),
        load: vi.fn(async () => frozen),
        markOutput: vi.fn(async function _Mark(_bootstrapId, receipt) { return { outcome: "accepted" as const, receipt }; }),
        loadActive: vi.fn().mockResolvedValue(null),
        settle: vi.fn().mockResolvedValue(undefined),
      },
      writers: { create: vi.fn((turn) => ({ append, prepare: async function _Prepare(command: Parameters<BoundConversationWriter["prepare"]>[0])
      {
        const writer = new BoundConversationWriter({} as never, turn.binding, { now: function _Now() { return new Date(); } }, { assertMayAppend: async function _Rate() {} }, { assertMayUseVisibility: async function _Visibility() {} }, { assertMayAppend: async function _Fence() {} });
        return writer.prepare(command);
      } })) },
    });
    const workload = {
      subject: "system:serviceaccount:testv5:computer",
      namespace: "testv5",
      serviceAccountName: "computer",
      podUid: "pod-one",
    };
    const app = express()
      .use(express.json())
      .use(
        _CreateConversationComputerTurnRouter({
          logger: { warn: vi.fn() },
          tokenReviewer: { __Review: vi.fn().mockResolvedValue(workload) },
          authority,
        }),
      );
    const bootstrap = await request(app)
      .get("/bootstrap?computerId=computer-one&generation=1&leaseId=lease-one")
      .set("authorization", "Bearer projected");
    const modelText = {
      choices: [{ message: { content: "assistant answer" } }],
    }.choices[0]!.message.content;
    await request(app)
      .post("/output")
      .set("authorization", "Bearer projected")
      .send({
        bootstrapId: bootstrap.body.bootstrapId,
        sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
        text: modelText,
      })
      .expect(202);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ data: expect.objectContaining({ entry: expect.objectContaining({ kind: "message", blocks: [expect.objectContaining({ payloadRef: "payload-one" })] }) }) }),
      }),
    );
  });
});
