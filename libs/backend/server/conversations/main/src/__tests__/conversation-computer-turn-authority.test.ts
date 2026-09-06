import { describe, expect, it, vi } from "vitest";

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
    siloId: "testv5",
    candidates: {
      resolve: vi
        .fn()
        .mockResolvedValue({
          binding: _BINDING,
          compiledInput: _COMPILED,
          latestPendingEntryId: "entry-1",
          modelAlias: "testv5-default",
          maximumBudgetUsd: 0.1,
          credentialLifetimeSeconds: 300,
          sandboxClaimId: "computer-1-g2",
        }),
      assertCurrent: vi.fn().mockResolvedValue(undefined),
    },
    credentials: {
      issueOrRotate: vi
        .fn()
        .mockResolvedValue({
          key: "sk-attempt",
          credentialDigest: `sha256:${"b".repeat(64)}`,
        }),
      revoke: vi.fn().mockResolvedValue(undefined),
    },
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
        receipt: { readonly sourceCommandId: string; readonly blockId: string; readonly payloadRef: string; readonly ciphertextDigest: string },
      ) {
        if (stored?.outputSourceCommandId === receipt.sourceCommandId)
          return "idempotent" as const;
        stored = { ...stored!, outputSourceCommandId: receipt.sourceCommandId, outputReceipt: receipt };
        return "accepted" as const;
      }),
      settle: vi.fn(async function _Settle() { active = false; }),
    },
    writers: { create: vi.fn(() => ({ append })) },
  };
  return {
    authority: new ConversationComputerTurnAuthority(dependencies),
    append,
    dependencies,
  };
}

describe("ConversationComputerTurnAuthority", function _Suite() {
  it("freezes a deterministic turn and returns only an attempt-scoped credential", async function _Bootstrap() {
    const { authority, dependencies } = _Harness();
    const command = {
      computerId: "computer-1",
      generation: 2,
      leaseId: "lease-1",
      workload: _WORKLOAD,
    };
    const first = await authority.bootstrap(command);
    const duplicate = await authority.bootstrap(command);
    expect(duplicate?.bootstrapId).toBe(first?.bootstrapId);
    expect(first?.compiledInput).toEqual(_COMPILED);
    const frozen = dependencies.store.createOrRead.mock.calls[0]?.[0];
    expect(frozen).not.toHaveProperty("compiledInput");
    expect(frozen?.compile).toEqual({
      runId: "run-1",
      attempt: 1,
      promptCompilerVersion: "conversation-computer-v1",
      digest: `sha256:${"a".repeat(64)}`,
    });
    expect(first?.modelCredential).toEqual({
      endpoint: "http://litellm.testv5.svc.cluster.local:4000",
      key: "sk-attempt",
      model: "testv5-default",
    });
    expect(dependencies.credentials.issueOrRotate).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapId: first?.bootstrapId,
        keyAlias: expect.stringMatching(/^attempt-[a-f0-9]{40}$/),
        modelAlias: "testv5-default",
		maxBudgetUsd: 0.05,
      }),
    );
  });

  it("appends one safe encrypted payload reference and makes the retry idempotent", async function _Output() {
    const { authority, append, dependencies } = _Harness();
    const bootstrap = await authority.bootstrap({
      computerId: "computer-1",
      generation: 2,
      leaseId: "lease-1",
      workload: _WORKLOAD,
    });
    const command = {
      bootstrapId: bootstrap!.bootstrapId,
      sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
      text: "Hi",
      workload: _WORKLOAD,
    };
    await expect(authority.appendOutput(command)).resolves.toBe("accepted");
    await expect(authority.appendOutput(command)).resolves.toBe("idempotent");
    expect(append).toHaveBeenCalledTimes(2);
    expect(dependencies.credentials.revoke).toHaveBeenCalledWith(
      bootstrap!.bootstrapId,
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({
          blocks: [expect.objectContaining({ payloadRef: "payload-1" })],
        }),
      }),
    );
  });

  it("converges after the history append succeeds but the first completion marker fails", async function _AppendResponseLoss() {
    const { authority, append, dependencies } = _Harness();
    const bootstrap = await authority.bootstrap({
      computerId: "computer-1",
      generation: 2,
      leaseId: "lease-1",
      workload: _WORKLOAD,
    });
    dependencies.runLifecycle.complete
      .mockRejectedValueOnce(new Error("lifecycle unavailable"))
      .mockResolvedValueOnce(undefined);
    const command = {
      bootstrapId: bootstrap!.bootstrapId,
      sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
      text: "Hi",
      workload: _WORKLOAD,
    };
    await expect(authority.appendOutput(command)).rejects.toThrow(
      "lifecycle unavailable",
    );
    const restartedWorker = new ConversationComputerTurnAuthority(dependencies);
    await expect(restartedWorker.bootstrap({ computerId: "computer-1", generation: 2, leaseId: "lease-1", workload: _WORKLOAD })).resolves.toBeNull();
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0].sourceCommandId).toBe(
      append.mock.calls[1]?.[0].sourceCommandId,
    );
    expect(dependencies.runLifecycle.complete).toHaveBeenCalledTimes(2);
    expect(dependencies.store.settle).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a retried bootstrap recompiles to a different digest", async function _DigestDrift() {
    const { authority, dependencies } = _Harness();
    const command = {
      computerId: "computer-1",
      generation: 2,
      leaseId: "lease-1",
      workload: _WORKLOAD,
    };
    await authority.bootstrap(command);
    dependencies.candidates.resolve.mockResolvedValue({
      binding: _BINDING,
      compiledInput: { ..._COMPILED, instructions: "Changed", digest: `sha256:${"c".repeat(64)}` },
      latestPendingEntryId: "entry-1",
      modelAlias: "testv5-default",
      maximumBudgetUsd: 0.1,
      credentialLifetimeSeconds: 300,
      sandboxClaimId: "computer-1-g2",
    });
    await expect(authority.bootstrap(command)).rejects.toThrow(
      /recompiled input .* does not match the frozen turn digest/,
    );
    expect(dependencies.credentials.issueOrRotate).toHaveBeenCalledTimes(1);
  });

  it("rejects stale or cross-silo workload evidence before credential or output use", async function _Fence() {
    const { authority, dependencies } = _Harness();
    dependencies.candidates.assertCurrent.mockRejectedValue(
      new Error("stale lease, generation, revision, or Pod binding"),
    );
    await expect(
      authority.bootstrap({
        computerId: "computer-1",
        generation: 3,
        leaseId: "lease-old",
        workload: { ..._WORKLOAD, namespace: "foreign" },
      }),
    ).rejects.toThrow(/stale lease/);
    expect(dependencies.credentials.issueOrRotate).not.toHaveBeenCalled();
  });
});
