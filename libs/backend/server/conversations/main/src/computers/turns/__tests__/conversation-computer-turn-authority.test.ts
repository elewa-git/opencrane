import type { ConversationComputerToolSelection } from "../conversation-computer-continuation.types";
import { _ReserveConversationOutputFixture } from "./conversation-output-intent.fixture";
import type { ConversationComputerModelReservation } from "../conversation-computer-model.types";
import { _PrepareBoundDraft } from "./conversation-output-intent.fixture";
import type { BoundConversationWriterAppend } from "@opencrane/backend/server/conversations/history";
import type { ConversationComputerTurnOutputReceipt } from "../conversation-computer-turn.types";
import { describe, expect, it, vi } from "vitest";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationComputerTurnAuthority } from "../conversation-computer-turn-authority";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

const _WORKLOAD = {
  subject: "system:serviceaccount:testv5:conversation-computer",
  namespace: "testv5",
  serviceAccountName: "conversation-computer",
  podUid: "pod-1",
};
const _BINDING = {
  siloId: "testv5",
  conversationId: "conversation-1",
  computerId: "computer-1",
  leaseGeneration: 2,
  agentIdentityId: "identity-1",
  agentServiceId: "service-1",
  agentName: "Ada",
  agentAvatarArtifactRevisionId: null,
  runId: "run-1",
  expectedRevision: 1n,
  maximumEntryBytes: 65_536,
};
const _COMPILED = {
  promptCompilerVersion: "conversation-computer-v1",
  runId: "run-1",
  attempt: 1,
  instructions: "Help",
  messages: [{ role: "user" as const, content: "Hello" }],
  tools: [],
  model: {
    modelAlias: "testv5-default",
    maxOutputTokens: 512,
    generatedOutputCapabilities: [],
  },
  budget: {
    maxModelTurns: 1,
    maxCompletionTokens: 1_024,
    maxCostUsdMicros: 50_000,
    maxToolInvocations: 0,
    wallClockDeadlineEpochMs: null,
  },
  digest: `sha256:${"a".repeat(64)}`,
};

function _Harness() {
  let stored: FrozenConversationComputerTurn | null = null;
  let active = false;
  const append = vi.fn().mockResolvedValue({});
  const dependencies = {
    logger: { warn: vi.fn() }, model: { request: vi.fn().mockResolvedValue({ kind: "text", text: "Hi" }) },
    siloId: "testv5",
    toolProposals: { admit: vi.fn() },
    candidates: {
      resolve: vi.fn(),
      resolveForWorkflow: vi
        .fn()
        .mockResolvedValue({ candidate: {
          binding: _BINDING,
          compiledInput: _COMPILED,
          latestPendingEntryId: "entry-1",
          latestPendingEntryPosition: "1",
          modelAlias: "testv5-default",
          maximumBudgetUsd: 0.1,
          credentialLifetimeSeconds: 300,
          credentialExpiresAt: "2099-01-01T00:00:00.000Z",
          lease: { leaseId: "lease-1", leaseGeneration: 2, sandboxClaimId: "computer-1-g2" },
        }, workload: _WORKLOAD }),
      assertCurrentForWorkflow: vi.fn().mockResolvedValue(undefined),
      assertLeaseForWorkflow: vi.fn().mockResolvedValue(_WORKLOAD),
      assertCurrent: vi.fn().mockResolvedValue(undefined),
      admit: vi.fn().mockResolvedValue(undefined),
    },
    reviewCredentials: { bearer: vi.fn(), derive: vi.fn().mockReturnValue("keyed-review-secret") },
    credentials: {
      issueOnce: vi
        .fn()
        .mockResolvedValue({
          key: "sk-attempt",
          credentialDigest: `sha256:${"b".repeat(64)}`,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      reuseExact: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined),
    },
    modelCustody: { loadDeclaration: vi.fn().mockResolvedValue(null), storeDeclaration: vi.fn(), loadContinuation: vi.fn(), storeContinuation: vi.fn() },
    toolResults: { read: vi.fn(), consume: vi.fn() }, toolResultNotifications: { publishTerminal: vi.fn().mockResolvedValue("published") },
    endpoint: "http://litellm.testv5.svc.cluster.local:4000",
    outputPayloads: {
      store: vi
        .fn()
        .mockResolvedValue({
          blockId: "block-1",
          payloadRef: "payload-1",
          ciphertextDigest: "sha256:ciphertext",
        }),
    },
    runLifecycle: {
      start: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
    },
    store: {
      reserveContinuation: vi.fn(),
      reserveModel: vi.fn(async function _ReserveModel(_id: string, reservation: ConversationComputerModelReservation)
      {
        if (stored?.modelReservation !== null || stored?.toolSelection !== null)
          return false;
        stored = { ...stored!, modelReservation: reservation };
        return true;
      }),
      selectTool: vi.fn(async function _Reserve(_id: string, reservation: ConversationComputerToolSelection) { stored = { ...stored!, toolSelection: reservation }; }),
      createOrRead: vi.fn(async function _Create(
        turn: FrozenConversationComputerTurn,
      ) {
        stored ??= turn;
        active = true;
        return stored;
      }),
      load: vi.fn(async function _Load() {
        return stored;
      }),
      loadActive: vi.fn(async function _LoadActive() {
        return active ? stored : null;
      }),
      markOutput: vi.fn(async function _Mark(
        _id: string,
        receipt: ConversationComputerTurnOutputReceipt,
      ) {
        if (stored?.outputSourceCommandId === receipt.event.id)
          return { outcome: "idempotent" as const, receipt };
        stored = { ...stored!, outputSourceCommandId: receipt.event.id, outputReceipt: receipt };
        return { outcome: "accepted" as const, receipt };
      }),
      settle: vi.fn(async function _Settle() { active = false; }),
    },
    writers: { create: vi.fn((turn: FrozenConversationComputerTurn) => ({ confirm: append, prepare: async function _Prepare(command: BoundConversationWriterAppend) { return _PrepareBoundDraft(turn.binding, command); } })) },
  };
  dependencies.candidates.assertCurrentForWorkflow.mockImplementation(() => dependencies.candidates.resolveForWorkflow());
  dependencies.candidates.assertCurrent.mockImplementation(async () => (await dependencies.candidates.resolveForWorkflow()).candidate);
  return {
    authority: new ConversationComputerTurnAuthority(dependencies),
    append,
    dependencies,
  };
}

describe("ConversationComputerTurnAuthority", function _Suite() {
  it("hands out the derived review credential after Pod admission without compiling or admitting a run", async function _ReviewCredential() {
    const { authority, dependencies } = _Harness();
    const command = { computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2 },
      causationId: "entry-1",
      causationPosition: "1", workload: _WORKLOAD };
    expect(await authority.reviewCredential(command)).toEqual({ reviewCredential: "keyed-review-secret" });
    expect(dependencies.candidates.admit).toHaveBeenCalledWith(command);
    expect(dependencies.reviewCredentials.derive).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2 } });
    expect(dependencies.candidates.resolveForWorkflow).not.toHaveBeenCalled();
    expect(dependencies.runLifecycle.start).not.toHaveBeenCalled();
    dependencies.candidates.admit.mockRejectedValue(new Error("not the bound Pod"));
    await expect(authority.reviewCredential(command)).rejects.toThrow("not the bound Pod");
    expect(dependencies.reviewCredentials.derive).toHaveBeenCalledTimes(1);
  });

  it("freezes a deterministic turn without returning model input or credentials", async function _Bootstrap() {
    const { authority, dependencies } = _Harness();
    const command = {
      computerId: "computer-1",
      lease: { leaseId: "lease-1", leaseGeneration: 2 },
      causationId: "entry-1",
      causationPosition: "1",
    };
    const first = await authority.start(command);
    const duplicate = await authority.start(command);
    expect(duplicate?.bootstrapId).toBe(first?.bootstrapId);
    expect(first).toMatchObject({ bootstrapId: first!.bootstrapId });
    const frozen = dependencies.store.createOrRead.mock.calls[0]?.[0];
    expect(frozen).not.toHaveProperty("compiledInput");
    expect(frozen?.compile).toEqual({
      runId: "run-1",
      attempt: 1,
      promptCompilerVersion: "conversation-computer-v1",
      digest: `sha256:${"a".repeat(64)}`,
    });
    expect(dependencies.credentials.issueOnce).not.toHaveBeenCalled();
  });

  it("appends one safe encrypted payload reference and makes the retry idempotent", async function _Output() {
    const { authority, append, dependencies } = _Harness();
    const bootstrap = await authority.start({
      computerId: "computer-1",
      lease: { leaseId: "lease-1", leaseGeneration: 2 },
      causationId: "entry-1",
      causationPosition: "1",
    });
    const command = {
      bootstrapId: bootstrap!.bootstrapId,
      sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
      modelInvocationFence: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", modelNotAfterEpochMs: Date.parse("2099-01-01T00:00:00Z"),
      text: "Hi",
    };
    await _ReserveConversationOutputFixture(dependencies.store, command.bootstrapId, command.sourceCommandId);
    await expect(authority.appendOutput(command)).resolves.toBe("accepted");
    await expect(authority.appendOutput(command)).resolves.toBe("idempotent");
    expect(append).toHaveBeenCalledTimes(2);
    expect(dependencies.credentials.revoke).toHaveBeenCalledWith(
      bootstrap!.bootstrapId,
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ data: expect.objectContaining({ entry: expect.objectContaining({ blocks: [expect.objectContaining({ payloadRef: "payload-1" })] }) }) }),
      }),
    );
  });

  it("converges after the history append succeeds but the first completion marker fails", async function _AppendResponseLoss() {
    const { authority, append, dependencies } = _Harness();
    const bootstrap = await authority.start({
      computerId: "computer-1",
      lease: { leaseId: "lease-1", leaseGeneration: 2 },
      causationId: "entry-1",
      causationPosition: "1",
    });
    dependencies.runLifecycle.complete
      .mockRejectedValueOnce(new Error("lifecycle unavailable"))
      .mockResolvedValueOnce(undefined);
    const command = {
      bootstrapId: bootstrap!.bootstrapId,
      sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
      modelInvocationFence: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", modelNotAfterEpochMs: Date.parse("2099-01-01T00:00:00Z"),
      text: "Hi",
    };
    await _ReserveConversationOutputFixture(dependencies.store, command.bootstrapId, command.sourceCommandId);
    await expect(authority.appendOutput(command)).rejects.toThrow(
      "lifecycle unavailable",
    );
    const restartedWorker = new ConversationComputerTurnAuthority(dependencies);
    await expect(restartedWorker.start({ computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2 }, causationId: "entry-1", causationPosition: "1" })).resolves.toBeNull();
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0].event.id).toBe(
      append.mock.calls[1]?.[0].event.id,
    );
    expect(dependencies.runLifecycle.complete).toHaveBeenCalledTimes(2);
    expect(dependencies.store.settle).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a retried bootstrap recompiles to a different digest", async function _DigestDrift() {
    const { authority, dependencies } = _Harness();
    const command = {
      computerId: "computer-1",
      lease: { leaseId: "lease-1", leaseGeneration: 2 },
      causationId: "entry-1",
      causationPosition: "1",
    };
    await authority.start(command);
    dependencies.candidates.assertCurrentForWorkflow.mockResolvedValue({
      candidate: {
        binding: _BINDING,
        compiledInput: { ..._COMPILED, instructions: "Changed", digest: `sha256:${"c".repeat(64)}` },
        latestPendingEntryId: "entry-1",
        latestPendingEntryPosition: "1",
        modelAlias: "testv5-default",
        maximumBudgetUsd: 0.1,
        credentialLifetimeSeconds: 300,
        credentialExpiresAt: "2099-01-01T00:00:00.000Z",
        lease: { leaseId: "lease-1", leaseGeneration: 2, sandboxClaimId: "computer-1-g2" },
      },
      workload: _WORKLOAD,
    });
    dependencies.candidates.resolveForWorkflow.mockResolvedValue(await dependencies.candidates.assertCurrentForWorkflow());
    await expect(authority.start(command)).rejects.toThrow(
      /recompiled input .* does not match the frozen turn digest/,
    );
    expect(dependencies.credentials.issueOnce).not.toHaveBeenCalled();
  });

  it("rejects stale or cross-silo workload evidence before credential or output use", async function _Fence() {
    const { authority, dependencies } = _Harness();
    dependencies.candidates.assertCurrentForWorkflow.mockRejectedValue(
      new Error("stale lease, generation, revision, or Pod binding"),
    );
    await expect(authority.start({ computerId: "computer-1", lease: { leaseId: "lease-old", leaseGeneration: 3 }, causationId: "entry-1", causationPosition: "1" })).rejects.toThrow(/stale lease/);
    expect(dependencies.credentials.issueOnce).not.toHaveBeenCalled();
  });
  it("uses the current absolute authority bound when reserving the model request", async function () {
    const { authority, dependencies } = _Harness();
    const command = { computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2 }, causationId: "entry-1", causationPosition: "1" };
    const bootstrap = await authority.start(command);
    const execution = await dependencies.candidates.resolveForWorkflow(command);
    const candidate = execution.candidate;
    const notAfter = new Date(Date.now() + 20_000).toISOString();
    dependencies.candidates.resolveForWorkflow.mockResolvedValue({ candidate: { ...candidate, credentialLifetimeSeconds: 20, credentialExpiresAt: notAfter }, workload: _WORKLOAD });
    expect(await authority.advance(bootstrap!.bootstrapId)).toEqual({ outcome: "completed" });
    expect(dependencies.credentials.issueOnce).toHaveBeenLastCalledWith(expect.objectContaining({ expirySeconds: 20, notAfter }));
    expect(dependencies.model.request).toHaveBeenCalledWith(expect.objectContaining({ maxCompletionTokens: 512, notAfterEpochMs: Date.parse(notAfter) }));
  });

});
