import { ConversationComputerStates } from "@opencrane/contracts";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const _Mocks = vi.hoisted(function _CreateMocks() {
  return {
    append: vi.fn(),
    appendAtomic: vi.fn(),
    identityLoad: vi.fn(),
    identityLoadActive: vi.fn(),
    identityAppend: vi.fn(),
    conversationRead: vi.fn(),
    conversationReadGenesis: vi.fn(),
    computerLoad: vi.fn(),
    admit: vi.fn(),
    reconcileParticipants: vi.fn(),
    reconcileCreator: vi.fn(),
  };
});

vi.mock("@opencrane/backend/server/iam/identity", function _MockIdentity() {
  return {
    AgentIdentityHistory: class {
      public load = _Mocks.identityLoad;
      public loadActive = _Mocks.identityLoadActive;
      public append = _Mocks.identityAppend;
    },
  };
});
vi.mock("@opencrane/backend/server/conversations/history", async function _MockConversationReader(importOriginal) {
  const actual = await importOriginal<typeof import("@opencrane/backend/server/conversations/history")>();
  return {
    ...actual,
    ConversationHistoryReader: class {
      public read = _Mocks.conversationRead;
      public readGenesis = _Mocks.conversationReadGenesis;
    },
  };
});
vi.mock("@opencrane/backend/server/conversations/computers", function _MockComputerHistory() {
  return {
    ConversationComputerHistory: class {
      public load = _Mocks.computerLoad;
    },
  };
});
vi.mock(
  "../../authorization/db/conversation-product-authorization",
  function _MockAuthorization() {
    return {
      PrismaConversationProductAuthorizationRepository: class {
        public admit = _Mocks.admit;
        public reconcileParticipants = _Mocks.reconcileParticipants;
        public reconcileCreator = _Mocks.reconcileCreator;
      },
    };
  },
);

import { PrismaAgentSessionCreationUnitOfWork } from "../agent-session-creation";

/** Identifies a creation request that retries must retain. */
const _CREATE_KEY = "57de859d-1fb6-4782-aa0b-2b3d4dfd2292";
/** Identifies a deliberate second session with the same personal assistant. */
const _NEXT_CREATE_KEY = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Creates the minimum transaction surface needed to exercise Kurrent-first creation. */
function _Prisma(workloadProfile = "personal-default")
{
  const transaction = {
    orgMembership: { count: vi.fn().mockResolvedValue(1) },
    agentService: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: "service-1",
          name: "Personal agent",
          workloadProfile,
          activeRevision: {
            personaRevisionId: "persona-1",
            state: "Published",
          },
        }),
    },
    personaProfile: { count: vi.fn().mockResolvedValue(1) },
    conversation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn().mockImplementation(function _Transaction(work) {
        return work(transaction);
      }),
    },
    transaction,
  };
}

describe("PrismaAgentSessionCreationCoordinator", function _DescribeCoordinator() {
  beforeEach(function _Reset() {
    vi.clearAllMocks();
    _Mocks.admit.mockResolvedValue(true);
    _Mocks.identityLoad.mockResolvedValue(null);
    _Mocks.identityLoadActive.mockResolvedValue({
      identity: { state: "active" },
    });
    _Mocks.identityAppend.mockResolvedValue({});
    _Mocks.appendAtomic.mockResolvedValue([]);
    _Mocks.append.mockResolvedValue({});
    _Mocks.conversationRead.mockImplementation(function _Read(command) {
      return {
        genesis: {
          mode: "agent_session",
          agentServiceId: "service-1",
          createdByPrincipalId: "principal-1",
        },
        entries: [],
        streamName: `conversation-${command.conversationId}`,
      };
    });
    _Mocks.computerLoad.mockImplementation(function _Load(command) {
      return {
        computer: {
          id: command.computerId,
          state: ConversationComputerStates.Cold,
          leaseGeneration: 1,
        },
        lease: null,
      };
    });
  });

  it("verifies ordinary genesis after a competing append without replaying all messages", async function _OrdinaryGenesisRetry()
  {
    const harness = _Prisma();
    const resolver = new PrismaAgentSessionCreationUnitOfWork(harness.prisma as never, _Mocks as never, []);
    _Mocks.append.mockRejectedValue(new WrongExpectedVersionError(undefined, { streamName: `conversation-${_CREATE_KEY}`, expected: -1n, current: 3n }));
    _Mocks.conversationReadGenesis.mockResolvedValue({ mode: "group", agentServiceId: null, createdByPrincipalId: "principal-1" });
    const caller = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };
    await expect(resolver.createOrdinaryGenesis(caller, _CREATE_KEY, "group")).resolves.toBeUndefined();
    expect(_Mocks.conversationReadGenesis).toHaveBeenCalledWith({ siloId: "silo-1", conversationId: _CREATE_KEY, maximumBytes: 65536, signal: expect.any(AbortSignal) });
    expect(_Mocks.conversationRead).not.toHaveBeenCalled();
    await expect(resolver.createOrdinaryGenesis(caller, _CREATE_KEY, "direct")).rejects.toThrow("does not match");
  });

  it("bounds ordinary genesis verification and allows the same creation to retry after timeout", async function _GenesisTimeout()
  {
    const harness = _Prisma();
    const resolver = new PrismaAgentSessionCreationUnitOfWork(harness.prisma as never, _Mocks as never, []);
    const caller = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };
    const abort = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(abort.signal);
    _Mocks.conversationReadGenesis.mockImplementationOnce(function _DisconnectedRead(command)
    {
      return new Promise(function _UntilAbort(_resolve, reject)
      {
        command.signal.addEventListener("abort", function _RejectRead() { reject(command.signal.reason); }, { once: true });
      });
    });
    try
    {
      const failed = resolver.createOrdinaryGenesis(caller, _CREATE_KEY, "group");
      await vi.waitFor(function _ReadStarted() { expect(timeout).toHaveBeenCalledWith(10_000); });
      abort.abort(new DOMException("Genesis read timed out", "TimeoutError"));
      await expect(failed).rejects.toThrow("Genesis read timed out");
      _Mocks.conversationReadGenesis.mockResolvedValue({ mode: "group", agentServiceId: null, createdByPrincipalId: "principal-1" });
      await expect(resolver.createOrdinaryGenesis(caller, _CREATE_KEY, "group")).resolves.toBeUndefined();
      expect(_Mocks.conversationReadGenesis.mock.calls.map(([command]) => command.conversationId)).toEqual([_CREATE_KEY, _CREATE_KEY]);
    }
    finally
    {
      timeout.mockRestore();
    }
  });

  it.each(["developer", "research"])("creates the cold computer for the configured %s profile before projection", async function _CreatesSession(workloadProfile)
  {
    const harness = _Prisma(workloadProfile);
    const historyStore = {
      append: _Mocks.append,
      appendAtomic: _Mocks.appendAtomic,
      readHead: vi.fn(),
      readStream: vi.fn(),
    };
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(
      harness.prisma as never,
      historyStore as never,
      [
        {
          workloadProfile,
          profileRevisionId: `sha256:${"a".repeat(64)}`,
        },
      ],
    );
    const result = await coordinator.resolve(
      { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" },
      "service-1",
      _CREATE_KEY,
    );

    expect(result).toMatch(/^[0-9a-f-]{36}$/u);
    const atomic = _Mocks.appendAtomic.mock.calls[0]![0];
    const computerAppend = atomic.appends[1];
    expect(computerAppend.streamName).toMatch(
      /^conversation-computer-computer-[0-9a-f-]{36}$/u,
    );
    expect(computerAppend.events[0].data.computer).toMatchObject({
      state: ConversationComputerStates.Cold,
      leaseGeneration: 1,
      profileRevisionId: `sha256:${"a".repeat(64)}`,
    });
    expect(harness.transaction.conversation.create).toHaveBeenCalledAfter(
      _Mocks.appendAtomic,
    );
  });

  it("rejects a service with an unconfigured profile before immutable history or projection writes", async function _RejectsProfileMismatch()
  {
    const harness = _Prisma("personal-default");
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(harness.prisma as never, { append: _Mocks.append, appendAtomic: _Mocks.appendAtomic, readHead: vi.fn(), readStream: vi.fn() } as never, [{ workloadProfile: "developer", profileRevisionId: `sha256:${"a".repeat(64)}` }]);
    await expect(coordinator.resolve({ siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" }, "service-1", _CREATE_KEY)).resolves.toBeNull();
    expect(_Mocks.appendAtomic).not.toHaveBeenCalled();
    expect(_Mocks.identityAppend).not.toHaveBeenCalled();
    expect(harness.transaction.conversation.create).not.toHaveBeenCalled();
  });

  it("denies missing authority before any immutable stream is created", async function _DeniesRevokedAuthority() {
    _Mocks.admit.mockResolvedValue(false);
    const harness = _Prisma();
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(
      harness.prisma as never,
      {
        append: _Mocks.append,
        appendAtomic: _Mocks.appendAtomic,
        readHead: vi.fn(),
        readStream: vi.fn(),
      } as never,
      [
        {
          workloadProfile: "personal-default",
          profileRevisionId: `sha256:${"a".repeat(64)}`,
        },
      ],
    );

    await expect(
      coordinator.resolve(
        {
          siloId: "silo-1",
          subjectId: "subject-1",
          principalId: "principal-1",
        },
        "service-1",
        _CREATE_KEY,
      ),
    ).resolves.toBeNull();
    expect(_Mocks.identityAppend).not.toHaveBeenCalled();
    expect(_Mocks.appendAtomic).not.toHaveBeenCalled();
  });

  it("rebuilds the same projection after a Kurrent-first retry conflict", async function _RetriesIdempotently() {
    const harness = _Prisma();
    const store = {
      append: _Mocks.append,
      appendAtomic: _Mocks.appendAtomic,
      readHead: vi.fn(),
      readStream: vi.fn(),
    };
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(
      harness.prisma as never,
      store as never,
      [
        {
          workloadProfile: "personal-default",
          profileRevisionId: `sha256:${"a".repeat(64)}`,
        },
      ],
    );
    const caller = {
      siloId: "silo-1",
      subjectId: "subject-1",
      principalId: "principal-1",
    };
    const first = await coordinator.resolve(caller, "service-1", _CREATE_KEY);
    const created =
      harness.transaction.conversation.create.mock.calls[0]![0].data;
    harness.transaction.conversation.findUnique.mockResolvedValue({
      siloId: created.siloId,
      mode: created.mode,
      agentServiceId: created.agentServiceId,
      computerId: created.computerId,
      computerAgentIdentityId: created.computerAgentIdentityId,
      computerProfileRevisionId: created.computerProfileRevisionId,
    });
    _Mocks.identityLoad.mockResolvedValue({ identity: { state: "active" } });
    _Mocks.appendAtomic.mockRejectedValue(
      new WrongExpectedVersionError(undefined, {
        streamName: `conversation-${first}`,
        expected: -1n,
        current: 0n,
      }),
    );

    _Mocks.computerLoad.mockResolvedValue({ computer: { state: ConversationComputerStates.Warm, leaseGeneration: 3 }, lease: { state: "active", generation: 3 } });

    await expect(coordinator.resolve(caller, "service-1", _CREATE_KEY)).resolves.toBe(first);
    expect(_Mocks.identityAppend).toHaveBeenCalledTimes(1);
    expect(harness.transaction.conversation.create).toHaveBeenCalledTimes(1);
    expect(_Mocks.reconcileParticipants).toHaveBeenCalledTimes(1);
    expect(_Mocks.reconcileCreator).toHaveBeenCalledTimes(1);
  });

  it("creates a separate conversation and computer after the former session is closed", async function _CreatesAfterClose()
  {
    const harness = _Prisma();
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(harness.prisma as never, { append: _Mocks.append, appendAtomic: _Mocks.appendAtomic, readHead: vi.fn(), readStream: vi.fn() } as never, [{ workloadProfile: "personal-default", profileRevisionId: `sha256:${"a".repeat(64)}` }]);
    const caller = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };
    const first = await coordinator.resolve(caller, "service-1", _CREATE_KEY);
    const former = { ...harness.transaction.conversation.create.mock.calls[0]![0].data, lifecycle: "Closed" };
    harness.transaction.conversation.findUnique.mockImplementation(async function _Read(query) { return query.where.id === first ? former : null; });
    _Mocks.identityLoad.mockResolvedValue({ identity: { state: "active" } });

    const next = await coordinator.resolve(caller, "service-1", _NEXT_CREATE_KEY);

    expect(next).not.toBe(first);
    const created = harness.transaction.conversation.create.mock.calls[1]![0].data;
    expect(created.computerId).not.toBe(former.computerId);
    expect(created.computerAgentIdentityId).toBe(former.computerAgentIdentityId);
    expect(former.lifecycle).toBe("Closed");
    expect(_Mocks.identityAppend).toHaveBeenCalledTimes(1);
    expect(_Mocks.appendAtomic.mock.calls[1]![0].appends[0].streamName).toBe(`conversation-${next}`);
  });

  it("rejects a creation key reused for a different personal assistant", async function _RejectsChangedTarget()
  {
    const harness = _Prisma();
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(harness.prisma as never, { append: _Mocks.append, appendAtomic: _Mocks.appendAtomic, readHead: vi.fn(), readStream: vi.fn() } as never, [{ workloadProfile: "personal-default", profileRevisionId: `sha256:${"a".repeat(64)}` }]);
    const caller = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };
    const first = await coordinator.resolve(caller, "service-1", _CREATE_KEY);
    harness.transaction.agentService.findFirst.mockResolvedValue({ id: "service-2", name: "Other assistant", workloadProfile: "personal-default", activeRevision: { personaRevisionId: "persona-1", state: "Published" } });
    _Mocks.appendAtomic.mockRejectedValue(new WrongExpectedVersionError(undefined, { streamName: `conversation-${first}`, expected: -1n, current: 0n }));

    await expect(coordinator.resolve(caller, "service-2", _CREATE_KEY)).rejects.toThrow("does not match the requested agent session");
    expect(_Mocks.appendAtomic.mock.calls[1]![0].appends[0].streamName).toBe(`conversation-${first}`);
    expect(harness.transaction.conversation.create).toHaveBeenCalledTimes(1);
    expect(_Mocks.reconcileParticipants).toHaveBeenCalledTimes(1);
  });

  it.each(["", "not-a-uuid", "57de859d-1fb6-0782-aa0b-2b3d4dfd2292"])("rejects invalid creation key %s before accessing authority or history", async function _InvalidKey(key)
  {
    const harness = _Prisma();
    const coordinator = new PrismaAgentSessionCreationUnitOfWork(harness.prisma as never, { append: _Mocks.append, appendAtomic: _Mocks.appendAtomic, readHead: vi.fn(), readStream: vi.fn() } as never, []);
    await expect(coordinator.resolve({ siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" }, "service-1", key)).resolves.toBeNull();
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(_Mocks.appendAtomic).not.toHaveBeenCalled();
  });
});
