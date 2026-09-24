import type { CompiledRunInput, ConversationEntry, MessageEntry } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerTurnUnitOfWork } from "../db/prisma-conversation-computer-turn-unit-of-work";
import { _ConversationAuthorizationFixture } from "../../../authorization/__tests__/conversation-authorization.fixtures";

const _COMMAND = {
  computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" },
  profileRevisionId: "profile-1",
  lease: { leaseId: "lease-1", leaseGeneration: 2, sandboxClaimId: "computer-1-g2" },
};

function _Entry(): MessageEntry {
  return {
    schemaVersion: 1,
    id: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
    conversationId: "conversation-1",
    position: "1",
    author: {
      kind: "human",
      principalId: "principal-1",
      participantId: "user-1",
      issuer: "https://issuer.test",
      authenticatedAt: "2026-09-05T00:00:00.000Z",
      name: "Jente",
      avatarArtifactRevisionId: null,
    },
    provenance: "human-authored",
    visibility: { audience: "conversation" },
    runId: null,
    causationId: "source-1",
    correlationId: "request-1",
    idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
    occurredAt: "2026-09-05T00:00:00.000Z",
    attestation: null,
    kind: "message",
    state: "completed",
    blocks: [
      {
        id: "block-1",
        kind: "text",
        payloadRef: "payload-1",
        ciphertextDigest: "sha256:cipher",
      },
    ],
    replyToEntryId: null,
    addressedAgentIdentityId: null,
    activation: "start",
  };
}

function _Genesis(): HistoryRecordedEvent {
  return {
    streamName: "conversation-conversation-1",
    id: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651",
    type: "opencrane.conversation-created.v1",
    data: {
      genesis: {
        schemaVersion: 1,
        siloId: "silo-1",
        conversationId: "conversation-1",
        mode: "agent_session",
        agentServiceId: "service-1",
        createdByPrincipalId: "principal-1",
        createdAt: "2026-09-05T00:00:00.000Z",
      },
    },
    metadata: { siloId: "silo-1", conversationId: "conversation-1" },
    revision: 0n,
    recordedAt: new Date("2026-09-05T00:00:00.000Z"),
  };
}

function _Event(entry: ConversationEntry = _Entry()): HistoryRecordedEvent {
  return {
    streamName: "conversation-conversation-1",
    id: entry.id,
    type: "opencrane.conversation-entry.v1",
    data: { entry },
    metadata: {
      siloId: "silo-1",
      conversationId: "conversation-1",
      causationId: entry.causationId,
      correlationId: entry.correlationId,
      idempotencyKey: entry.idempotencyKey,
    },
    revision: BigInt(entry.position),
    recordedAt: new Date(entry.occurredAt),
  };
}

function _Harness(
  memberships: readonly object[] = [{ subject: "user-1" }],
  admission = { admit: vi.fn().mockResolvedValue({ compiledInput: _CompiledInput(), authorityExpiresAt: "2099-01-01T00:00:00.000Z" }) },
  existingPayload: object | null = null,
  events: readonly HistoryRecordedEvent[] = [_Genesis(), _Event()],
) {
  const authorization = _ConversationAuthorizationFixture();
  const transaction = {
    ...authorization,
    conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) },
    conversation: {
      update: vi.fn().mockResolvedValue({ id: "conversation-1" }),
      findFirst: vi
        .fn()
        .mockResolvedValue({
          participants: [{ userId: "user-1" }],
          service: {
            id: "service-1",
            name: "Ada",
            activeRevision: {
              id: "revision-1",
              state: "Published",
              publishedAt: new Date("2026-09-05T00:00:00.000Z"),
              promptPolicyVersion: "compiler-v1",
              personaRevisionId: null,
              budget: { maxTokens: 2048 },
              modelDefinition: {
                publicModelName: "model-1",
                generatedOutputCapabilities: ["image_png"],
              },
            },
          },
        }),
    },
    orgMembership: { ...authorization.orgMembership, findMany: vi.fn().mockResolvedValue(memberships) },
    principal: {
      ...authorization.principal,
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: "principal-1",
          issuer: "https://issuer.test",
          subject: "user-1",
        }),
    },
    personaRevision: { findUnique: vi.fn() },
    conversationPrivatePayload: {
      findUnique: vi.fn().mockResolvedValue(existingPayload),
      create: vi.fn().mockResolvedValue(_PayloadRow("payload-created")),
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            id: "payload-1",
            siloId: "silo-1",
            conversationId: "conversation-1",
            authorSubject: "user-1",
            keyId: "key-1",
            nonce: Buffer.from("nonce"),
            authTag: Buffer.from("tag"),
            ciphertext: Buffer.from("cipher"),
            ciphertextDigest: "sha256:cipher",
          },
        ]),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: object) => Promise<unknown>) =>
        await operation(transaction),
    ),
  };
  const history = { readStream: vi.fn(async function* _History() { yield* events; }) };
  const cipher = {
    decrypt: vi.fn().mockReturnValue("Hello"),
    encrypt: vi.fn().mockReturnValue({
      keyId: "key-1",
      nonce: new Uint8Array(12),
      authTag: new Uint8Array(16),
      ciphertext: new Uint8Array([1]),
      ciphertextDigest: "sha256:cipher",
    }),
  };
  return {
    admission,
    transaction,
    authority: new PrismaConversationComputerTurnUnitOfWork(
      prisma as never,
      history,
      cipher as never,
      75_000,
      admission,
    ),
  };
}

function _PayloadRow(id: string) {
  return {
    id,
    siloId: "silo-1",
    conversationId: "conversation-1",
    authorSubject: "identity-1",
    idempotencyKey: "command-1",
    keyId: "key-1",
    nonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    ciphertext: Buffer.from([1]),
    ciphertextDigest: "sha256:cipher",
  };
}

function _Turn() {
  return {
    siloId: "silo-1",
    binding: { conversationId: "conversation-1", agentIdentityId: "identity-1" },
  } as never;
}

function _CompiledInput(): CompiledRunInput {
  return {
    promptCompilerVersion: "compiler-v1",
    runId: "96c97e9c-839f-481c-80bc-f2cdd6e4603b",
    attempt: 1,
    instructions: "Help",
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    model: {
      modelAlias: "model-1",
      maxOutputTokens: null,
      generatedOutputCapabilities: ["image_png"],
    },
    budget: {
      maxModelTurns: 1,
      maxCompletionTokens: 2_048,
      maxCostUsdMicros: 75_000,
      maxToolInvocations: 0,
      wallClockDeadlineEpochMs: null,
    },
    digest: `sha256:${"a".repeat(64)}`,
  };
}

afterEach(function _RestoreSpies() {
  vi.restoreAllMocks();
});

describe("PrismaConversationComputerTurnUnitOfWork", function _PrismaConversationComputerTurnUnitOfWorkSuite() {
  it("denies compilation after membership or current Use authority is revoked", async function _RevokedAuthority() {
    const revoked = _Harness();
    revoked.transaction.authorizationGrant.findMany.mockResolvedValue([]);
    await expect(revoked.authority.compile(_COMMAND)).rejects.toThrow(
      "currently authorized active participant",
    );
    expect(revoked.admission.admit).not.toHaveBeenCalled();
    await expect(_Harness([]).authority.compile(_COMMAND)).rejects.toThrow(
      "currently authorized active participant",
    );
  });

  it("refuses a pending child before durable run admission even when ordinary Use is allowed", async function () {
    const harness = _Harness();
    harness.transaction.conversationChildRequest.findUnique.mockResolvedValue({ siloId: "silo-1", state: "Pending", participantSubjectIds: ["user-1"] });
    await expect(harness.authority.compile(_COMMAND)).rejects.toThrow("currently authorized active participant");
    expect(harness.admission.admit).not.toHaveBeenCalled();
  });

  it("passes only server-resolved participant and lease coordinates into run admission", async function _AdmitsRun() {
    const harness = _Harness();
    const candidate = await harness.authority.compile(_COMMAND);
    expect(harness.transaction.auditDecision.create).not.toHaveBeenCalled();
    expect(candidate?.compiledInput).toMatchObject({
      runId: "96c97e9c-839f-481c-80bc-f2cdd6e4603b",
      attempt: 1,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(harness.admission.admit).toHaveBeenCalledWith({
      runId: "96c97e9c-839f-481c-80bc-f2cdd6e4603b",
      computer: _COMMAND.computer,
      agent: { agentServiceId: "service-1", agentRevisionId: "revision-1", profileRevisionId: "profile-1" },
      lease: _COMMAND.lease,
      requesterPrincipalId: "principal-1",
      requesterIssuer: "https://issuer.test",
      requesterSubjectId: "user-1",
      requesterAuthenticatedAt: "2026-09-05T00:00:00.000Z",
      requestIdempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
      messageInput: {
        mode: "pre_persisted_history",
        messageId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
        historyRevision: "1",
        orderedMessageIds: ["31c1f1dc-0010-4f13-9c2f-d3841ffd6651"],
      },
    });
  });

	it("recompiles a frozen message from its original prefix while reserving the current output head", async function _AnchoredPrefix()
	{
		const first = _Entry();
		const second = { ..._Entry(), id: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", position: "2", idempotencyKey: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", causationId: "source-2", correlationId: "request-2", blocks: [{ id: "block-2", kind: "text" as const, payloadRef: "payload-2", ciphertextDigest: "sha256:cipher" }] } satisfies ConversationEntry;
		const harness = _Harness(undefined, undefined, null, [_Genesis(), _Event(first), _Event(second)]);
		const candidate = await harness.authority.compile(_COMMAND, { expectedRevision: 1n, latestPendingEntryId: first.id });
		expect(candidate).toMatchObject({ latestPendingEntryId: first.id, latestPendingEntryPosition: "1", binding: { expectedRevision: 2n } });
		expect(harness.admission.admit).toHaveBeenCalledWith(expect.objectContaining({ requestIdempotencyKey: first.id, messageInput: { mode: "pre_persisted_history", messageId: first.id, historyRevision: "1", orderedMessageIds: [first.id] } }));
	});

  it("fails closed when the application-owned admission port rejects the run", async function _AdmissionDenied() {
    const admission = {
      admit: vi.fn().mockRejectedValue(new Error("run admission denied")),
    };
    await expect(
      _Harness(undefined, admission).authority.compile(_COMMAND),
    ).rejects.toThrow("run admission denied");
  });

  it("moves the conversation to the top of every list in the same transaction that stores new agent output", async function _BumpsOnStoredOutput() {
    const harness = _Harness();
    const receipt = await harness.authority.store(_Turn(), "command-1", "Hello");
    expect(receipt.payloadRef).toBe("payload-created");
    expect(harness.transaction.conversationPrivatePayload.create).toHaveBeenCalledTimes(1);
    expect(harness.transaction.conversation.update).toHaveBeenCalledWith({
      where: { id_siloId: { id: "conversation-1", siloId: "silo-1" } },
      data: { updatedAt: expect.any(Date) },
      select: { id: true },
    });
    expect(harness.transaction.conversation.update.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.transaction.conversationPrivatePayload.create.mock.invocationCallOrder[0]!,
    );
  });

  it("leaves the conversation ordering alone when the output payload was already stored", async function _NoBumpOnStoredRetry() {
    const harness = _Harness(undefined, undefined, _PayloadRow("payload-existing"));
    const receipt = await harness.authority.store(_Turn(), "command-1", "Hello");
    expect(receipt.payloadRef).toBe("payload-existing");
    expect(harness.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
    expect(harness.transaction.conversation.update).not.toHaveBeenCalled();
  });

  it("rejects compiled input for another run attempt", async function _MismatchedCompiledInput() {
    const admission = {
      admit: vi.fn().mockResolvedValue({ compiledInput: { ..._CompiledInput(), attempt: 2 }, authorityExpiresAt: "2099-01-01T00:00:00.000Z" }),
    };
    await expect(
      _Harness(undefined, admission).authority.compile(_COMMAND),
    ).rejects.toThrow("another run attempt");
  });
  it("caps fresh credentials to the remaining frozen run and membership authority", async function () {
    const now = Date.parse("2026-09-07T00:00:00.000Z"); vi.spyOn(Date, "now").mockReturnValue(now);
    const expiresAt = new Date(now + 31_500).toISOString();
    const admission = { admit: vi.fn().mockResolvedValue({ compiledInput: _CompiledInput(), authorityExpiresAt: expiresAt }) };
    const candidate = await _Harness(undefined, admission).authority.compile(_COMMAND);
    expect(candidate).toMatchObject({ credentialLifetimeSeconds: 31, credentialExpiresAt: expiresAt });
    admission.admit.mockResolvedValue({ compiledInput: _CompiledInput(), authorityExpiresAt: new Date(now).toISOString() });
    await expect(_Harness(undefined, admission).authority.compile(_COMMAND)).rejects.toThrow("unexpired run and membership authority");
  });

});
