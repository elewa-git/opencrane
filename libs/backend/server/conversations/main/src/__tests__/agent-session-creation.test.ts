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
vi.mock("../conversation-history-reader", function _MockConversationReader() {
  return {
    ConversationHistoryReader: class {
      public read = _Mocks.conversationRead;
    },
  };
});
vi.mock("../conversation-computers", function _MockComputerHistory() {
  return {
    ConversationComputerHistory: class {
      public load = _Mocks.computerLoad;
    },
  };
});
vi.mock(
  "../db/conversation-product-authorization",
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

/** Creates the minimum transaction surface needed to exercise Kurrent-first creation. */
function _Prisma() {
  const transaction = {
    orgMembership: { count: vi.fn().mockResolvedValue(1) },
    agentService: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: "service-1",
          name: "Personal agent",
          workloadProfile: "personal-default",
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

  it("atomically creates genesis and a DNS-safe cold generation-one computer before projection", async function _CreatesSession() {
    const harness = _Prisma();
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
          workloadProfile: "personal-default",
          profileRevisionId: `sha256:${"a".repeat(64)}`,
        },
      ],
    );
    const result = await coordinator.resolve(
      { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" },
      "service-1",
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
    const first = await coordinator.resolve(caller, "service-1");
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

    await expect(coordinator.resolve(caller, "service-1")).resolves.toBe(first);
    expect(_Mocks.identityAppend).toHaveBeenCalledTimes(1);
    expect(harness.transaction.conversation.create).toHaveBeenCalledTimes(1);
  });
});
