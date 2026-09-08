import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

const _ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _TURN = {
  bootstrapId: _ID,
  siloId: "testv5",
  computerId: "computer-1",
  lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" },
  latestPendingEntryId: "entry-1",
  modelAlias: "testv5-default",
  maximumBudgetUsd: 0.05,
  credentialLifetimeSeconds: 300,
  outputSourceCommandId: null,
  outputReceipt: null,
  toolReservation: null,
  binding: {
    siloId: "testv5",
    conversationId: "conversation-1",
    computerId: "computer-1",
    leaseGeneration: 1,
    agentIdentityId: "identity-1",
    agentServiceId: "service-1",
    agentName: "Ada",
    agentAvatarArtifactRevisionId: null,
    runId: "run-1",
    expectedRevision: 1n,
    maximumEntryBytes: 65_536,
  },
  compile: {
    runId: "run-1",
    attempt: 1,
    promptCompilerVersion: "computer-v1",
    digest: `sha256:${"a".repeat(64)}`,
  },
} satisfies FrozenConversationComputerTurn;

/** The frozen event data as KurrentDB stores it: flat lease fields and a string stream revision. */
const _STORED_TURN = {
  bootstrapId: _TURN.bootstrapId,
  siloId: _TURN.siloId,
  computerId: _TURN.computerId,
  generation: 1,
  leaseId: "lease-1",
  binding: { ..._TURN.binding, expectedRevision: "1" },
  latestPendingEntryId: _TURN.latestPendingEntryId,
  modelAlias: _TURN.modelAlias,
  maximumBudgetUsd: _TURN.maximumBudgetUsd,
  credentialLifetimeSeconds: _TURN.credentialLifetimeSeconds,
  sandboxClaimId: "computer-1-g1",
  compile: _TURN.compile,
};

describe("KurrentConversationComputerTurnStore", function _Suite() {
  it("freezes only coordinates and a digest, never compiled content or a raw model credential", async function _Freeze() {
    const append = vi
      .fn()
      .mockResolvedValue({
        streamName: `conversation-computer-turn-${_ID}`,
        revision: 0n,
      });
    const store = new KurrentConversationComputerTurnStore({
      append,
      readStream: vi.fn(() => (async function* _Empty() {})()),
    });
    const leaking = {
      ..._TURN,
      compiledInput: { instructions: "Help", messages: [{ role: "user", content: "Hi" }] },
    } as FrozenConversationComputerTurn;
    await store.createOrRead(leaking);
    const event = append.mock.calls[0]![0].events[0];
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("compiledInput");
    expect(serialized).not.toContain("instructions");
    expect(serialized).not.toContain("messages");
    expect(serialized).not.toContain("Help");
    expect(serialized).not.toContain('"Hi"');
    expect(event.data.turn.compile).toEqual({
      runId: "run-1",
      attempt: 1,
      promptCompilerVersion: "computer-v1",
      digest: `sha256:${"a".repeat(64)}`,
    });
    expect(event.data.turn).toEqual(_STORED_TURN);
  });

  it("gathers the stored flat lease fields back into the lease bundle", async function _LoadsStoredShape() {
    const frozenEvent = { streamName: `conversation-computer-turn-${_ID}`, revision: 0n, recordedAt: new Date(), id: _ID, type: "opencrane.conversation-computer-turn-frozen.v1", data: { turn: _STORED_TURN }, metadata: {} };
    const store = new KurrentConversationComputerTurnStore({ append: vi.fn(), readStream: vi.fn(() => (async function* _Events() { yield frozenEvent; })()) });
    await expect(store.load(_ID)).resolves.toEqual(_TURN);
  });

  it("rejects a frozen event that lacks the compile anchor", async function _MalformedFrozen() {
    const frozenEvent = {
      streamName: `conversation-computer-turn-${_ID}`,
      revision: 0n,
      recordedAt: new Date(),
      id: _ID,
      type: "opencrane.conversation-computer-turn-frozen.v1",
      data: {
        turn: { ..._STORED_TURN, compile: undefined },
      },
      metadata: {},
    };
    const store = new KurrentConversationComputerTurnStore({
      append: vi.fn(),
      readStream: vi.fn(() => (async function* _Events() { yield frozenEvent; })()),
    });
    await expect(store.load(_ID)).rejects.toThrow("malformed frozen data");
  });

  it("recognizes the same output retry after a checked-append conflict", async function _Retry() {
    const outputId = "b8871cc4-cc27-4dad-8785-b23896fa487d";
    const frozenEvent = {
      streamName: `conversation-computer-turn-${_ID}`,
      revision: 0n,
      recordedAt: new Date(),
      id: _ID,
      type: "opencrane.conversation-computer-turn-frozen.v1",
      data: { turn: _STORED_TURN },
      metadata: {},
    };
    const outputEvent = {
      streamName: `conversation-computer-turn-${_ID}`,
      revision: 1n,
      recordedAt: new Date(),
      id: outputId,
      type: "opencrane.conversation-computer-turn-output.v1",
      data: { bootstrapId: _ID, sourceCommandId: outputId, blockId: "block-1", payloadRef: "payload-1", ciphertextDigest: "sha256:ciphertext" },
      metadata: { bootstrapId: _ID },
    };
    const history = {
      append: vi
        .fn()
        .mockRejectedValue(
          new WrongExpectedVersionError(undefined, {
            streamName: `conversation-computer-turn-${_ID}`,
            expected: 0n,
            current: 1n,
          }),
        ),
      readStream: vi.fn(() =>
        (async function* _Events() {
          yield frozenEvent;
          yield outputEvent;
        })(),
      ),
    };
    await expect(
      new KurrentConversationComputerTurnStore(history).markOutput(
        _ID,
        { sourceCommandId: outputId, blockId: "block-1", payloadRef: "payload-1", ciphertextDigest: "sha256:ciphertext" },
      ),
    ).resolves.toBe("idempotent");
  });
});
