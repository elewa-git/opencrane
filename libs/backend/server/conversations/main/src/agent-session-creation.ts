import { createHash, randomUUID } from "node:crypto";

import { AgentServiceKind, AgentServiceState, ConversationMode, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { AgentIdentityStates, ConversationComputerStates, type AgentIdentity, type ConversationComputer } from "@opencrane/contracts";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { AgentSessionReleaseProfile, InitialConversationComputerResolver } from "./agent-session-creation.types";
import { ConversationHistoryAuthority } from "./conversation-history-authority";
import { ConversationHistoryReader } from "./conversation-history-reader";
import { ConversationComputerHistory } from "./conversation-computers";
import { PrismaConversationProductAuthorizationRepository } from "./db/conversation-product-authorization";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Prechecked relational facts that must survive the Kurrent-first creation boundary. */
interface AgentSessionCandidate {
  /** Identifies the active personal service. */
  readonly agentServiceId: string;
  /** Supplies the participant-facing identity name. */
  readonly agentName: string;
  /** Carries the release-mapped immutable profile revision. */
  readonly profileRevisionId: string;
  /** Preserves the service label resolved through the release profile map. */
  readonly workloadProfile: string;
}

/** Creates deterministic Kurrent-owned personal agent sessions and rebuildable projections. */
export class PrismaAgentSessionCreationUnitOfWork
  implements InitialConversationComputerResolver
{
  /** Validates agent identity history. */
  private readonly identities: AgentIdentityHistory;
  /** Validates conversation genesis and later participant history. */
  private readonly conversations: ConversationHistoryReader;
  /** Validates the initial logical computer snapshot. */
  private readonly computers: ConversationComputerHistory;
  /** Builds the immutable conversation genesis envelope. */
  private readonly historyAuthority: ConversationHistoryAuthority;

  /** Connects creation to PostgreSQL policy, KurrentDB, and the frozen release profile map. */
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly historyStore: Pick<
      HistoryStore,
      "append" | "appendAtomic" | "readHead" | "readStream"
    >,
    private readonly profiles: readonly AgentSessionReleaseProfile[],
  ) {
    this.identities = new AgentIdentityHistory(historyStore);
    this.conversations = new ConversationHistoryReader(historyStore);
    this.computers = new ConversationComputerHistory(historyStore);
    this.historyAuthority = new ConversationHistoryAuthority(historyStore);
  }

  /** Creates Kurrent history first, then authorizes its rebuildable PostgreSQL projection. */
  public async resolve(
    caller: ConversationCaller,
    personalAgentRef: string,
  ): Promise<string | null> {
    // 1. Precheck current relational authority so invalid requests cannot create orphan streams.
    const candidate = await this._candidate(caller, personalAgentRef);
    if (candidate === null)
return null;

    // 2. Ensure one deterministic active proxied identity bound to the caller's exact principal.
    const conversationId = _DeterministicUuid(
      "conversation",
      caller.siloId,
      caller.principalId,
      candidate.agentServiceId,
    );
    const agentIdentityId = _DeterministicUuid(
      "agent-identity",
      caller.siloId,
      caller.principalId,
      candidate.agentServiceId,
    );
    await this._ensureIdentity(caller, candidate, agentIdentityId);

    // 3. Atomically establish conversation genesis and the cold generation-one logical computer.
    const computerId = `computer-${_DeterministicUuid("conversation-computer", conversationId)}`;
    await this._ensureGenesisAndComputer(
      caller,
      candidate,
      conversationId,
      agentIdentityId,
      computerId,
    );

    // 4. Recheck authority serializably and persist only the rebuildable projection and grants.
    return this._project(
      caller,
      candidate,
      conversationId,
      agentIdentityId,
      computerId,
    );
  }

  /** Appends and verifies revision-zero history before an ordinary conversation projection exists. */
  public async createOrdinaryGenesis(
    caller: ConversationCaller,
    conversationId: string,
    mode: "direct" | "group",
  ): Promise<void> {
    const genesis = {
      schemaVersion: 1 as const,
      conversationId,
      siloId: caller.siloId,
      mode,
      agentServiceId: null,
      createdByPrincipalId: caller.principalId,
      createdAt: new Date().toISOString(),
    };
    const append = this.historyAuthority.genesisAppend(
      genesis,
      _DeterministicUuid("conversation-created", conversationId),
    );
    await this.historyStore.append(append);
    const history = await this.conversations.read({
      siloId: caller.siloId,
      conversationId,
    });
    if (
      history.genesis.mode !== mode ||
      history.genesis.agentServiceId !== null ||
      history.genesis.createdByPrincipalId !== caller.principalId
    )
      throw new Error(
        "Conversation genesis does not match the ordinary creation request",
      );
  }

  /** Loads an exact active personal service and checks collection creation authority. */
  private _candidate(
    caller: ConversationCaller,
    personalAgentRef: string,
  ): Promise<AgentSessionCandidate | null> {
    const profiles = this.profiles;
    return this.prisma.$transaction(
	      async function _Precheck(transaction)
	      {
        const membership = await transaction.orgMembership.count({
          where: {
            clusterTenant: caller.siloId,
            subject: caller.subjectId,
            status: OrgMemberStatus.Active,
          },
        });
        if (membership !== 1 || !personalAgentRef.trim())
return null;
        const service = await transaction.agentService.findFirst({
          where: {
            id: personalAgentRef,
            siloId: caller.siloId,
            kind: AgentServiceKind.Personal,
            state: AgentServiceState.Active,
            activeRevisionId: { not: null },
          },
          select: {
            id: true,
            name: true,
            workloadProfile: true,
            activeRevision: {
              select: { personaRevisionId: true, state: true },
            },
          },
        });
        if (
          service === null ||
          service.activeRevision === null ||
          service.activeRevision.personaRevisionId === null ||
          service.activeRevision.state !== "Published"
        )
          return null;
        const persona = await transaction.personaProfile.count({
          where: {
            siloId: caller.siloId,
            userId: caller.subjectId,
            activeRevisionId: service.activeRevision.personaRevisionId,
          },
        });
        if (persona !== 1)
return null;
        const profile = profiles.filter(
          (item) => item.workloadProfile === service.workloadProfile,
        );
        if (profile.length !== 1)
return null;
        const authorization =
          new PrismaConversationProductAuthorizationRepository(transaction);
        const admitted = await authorization.admit(
          caller,
          {
            kind: ProductAuthorizationResourceKinds.ConversationCollection,
            id: caller.siloId,
          },
          ProductAuthorizationActions.Create,
          { mode: "agent_session", agentServiceId: service.id },
        );
        if (!admitted)
return null;
        return {
          agentServiceId: service.id,
          agentName: service.name,
          profileRevisionId: profile[0]!.profileRevisionId,
          workloadProfile: service.workloadProfile,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Creates or verifies the caller-bound active proxied identity. */
  private async _ensureIdentity(
    caller: ConversationCaller,
    candidate: AgentSessionCandidate,
    agentIdentityId: string,
  ): Promise<void> {
    const command = {
      siloId: caller.siloId,
      agentIdentityId,
      agentServiceId: candidate.agentServiceId,
      principalId: caller.principalId,
    };
    const existing = await this.identities.load(command);
    if (existing !== null)
{
      await this.identities.loadActive(command);
      return;
    }
    const identity: AgentIdentity = {
      schemaVersion: 1,
      id: agentIdentityId,
      siloId: caller.siloId,
      agentServiceId: candidate.agentServiceId,
      name: candidate.agentName,
      avatarArtifactRevisionId: null,
      state: AgentIdentityStates.Active,
      createdByPrincipalId: caller.principalId,
      createdAt: new Date().toISOString(),
      kind: "proxied",
      proxiedPrincipalId: caller.principalId,
      delegationPolicyId: "personal-agent-session-v1",
    };
    try {
      await this.identities.append({
        expectedRevision: HistoryExpectedRevisions.NoStream,
        eventId: _DeterministicUuid("agent-identity-created", agentIdentityId),
        identity,
      });
    } catch (error) {
      if (!(error instanceof WrongExpectedVersionError))
throw error;
    }
    await this.identities.loadActive(command);
  }

  /** Atomically creates or verifies conversation genesis and its cold computer. */
  private async _ensureGenesisAndComputer(
    caller: ConversationCaller,
    candidate: AgentSessionCandidate,
    conversationId: string,
    agentIdentityId: string,
    computerId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const genesis = {
      schemaVersion: 1 as const,
      conversationId,
      siloId: caller.siloId,
      mode: "agent_session" as const,
      agentServiceId: candidate.agentServiceId,
      createdByPrincipalId: caller.principalId,
      createdAt: now,
    };
    const computer: ConversationComputer = {
      schemaVersion: 1,
      id: computerId,
      siloId: caller.siloId,
      conversationId,
      agentIdentityId,
      profileRevisionId: candidate.profileRevisionId,
      state: ConversationComputerStates.Cold,
      leaseGeneration: 1,
      workspaceCheckpoint: null,
      createdAt: now,
      updatedAt: now,
    };
    const genesisAppend = this.historyAuthority.genesisAppend(
      genesis,
      _DeterministicUuid("conversation-created", conversationId),
    );
    const computerAppend = {
      streamName: `conversation-computer-${computerId}`,
      expectedRevision: HistoryExpectedRevisions.NoStream,
      events: [
        {
          id: _DeterministicUuid("conversation-computer-created", computerId),
          type: "opencrane.conversation-computer.v1",
          data: { computer, lease: null },
          metadata: {
            siloId: caller.siloId,
            computerId,
            conversationId,
            agentIdentityId,
            profileRevisionId: candidate.profileRevisionId,
            leaseId: null,
            leaseGeneration: null,
            leaseState: null,
          },
        },
      ],
    };
    try {
      await this.historyStore.appendAtomic({
        expectedHeads: [
          {
            streamName: genesisAppend.streamName,
            revision: HistoryExpectedRevisions.NoStream,
          },
          {
            streamName: computerAppend.streamName,
            revision: HistoryExpectedRevisions.NoStream,
          },
        ],
        appends: [genesisAppend, computerAppend],
      });
    } catch (error) {
      if (!(error instanceof WrongExpectedVersionError))
throw error;
    }
    const history = await this.conversations.read({
      siloId: caller.siloId,
      conversationId,
    });
    if (
      history.genesis.mode !== "agent_session" ||
      history.genesis.agentServiceId !== candidate.agentServiceId ||
      history.genesis.createdByPrincipalId !== caller.principalId
    )
      throw new Error(
        "Existing conversation genesis does not match the requested agent session",
      );
    const currentComputer = await this.computers.load({
      siloId: caller.siloId,
      computerId,
      conversationId,
      agentIdentityId,
      profileRevisionId: candidate.profileRevisionId,
    });
    if (
      currentComputer === null ||
      currentComputer.computer.state !== ConversationComputerStates.Cold ||
      currentComputer.computer.leaseGeneration !== 1 ||
      currentComputer.lease !== null
    )
      throw new Error(
        "Conversation creation requires one cold generation-one computer",
      );
  }

  /** Rechecks all mutable authority before inserting or validating the projection. */
  private _project(
    caller: ConversationCaller,
    candidate: AgentSessionCandidate,
    conversationId: string,
    agentIdentityId: string,
    computerId: string,
  ): Promise<string | null> {
    return this.prisma.$transaction(
	      async function _Projection(transaction)
	      {
        const membership = await transaction.orgMembership.count({
          where: {
            clusterTenant: caller.siloId,
            subject: caller.subjectId,
            status: OrgMemberStatus.Active,
          },
        });
        const service = await transaction.agentService.findFirst({
          where: {
            id: candidate.agentServiceId,
            siloId: caller.siloId,
            kind: AgentServiceKind.Personal,
            state: AgentServiceState.Active,
            workloadProfile: { not: "" },
            activeRevisionId: { not: null },
          },
          select: {
            workloadProfile: true,
            activeRevision: {
              select: { personaRevisionId: true, state: true },
            },
          },
        });
        if (
          membership !== 1 ||
          service === null ||
          service.workloadProfile !== candidate.workloadProfile ||
          service.activeRevision?.personaRevisionId === null ||
          service.activeRevision?.state !== "Published"
        )
          return null;
        const persona = await transaction.personaProfile.count({
          where: {
            siloId: caller.siloId,
            userId: caller.subjectId,
            activeRevisionId: service.activeRevision.personaRevisionId,
          },
        });
        if (persona !== 1)
return null;
        const authorization =
          new PrismaConversationProductAuthorizationRepository(transaction);
        const admitted = await authorization.admit(
          caller,
          {
            kind: ProductAuthorizationResourceKinds.ConversationCollection,
            id: caller.siloId,
          },
          ProductAuthorizationActions.Create,
          { mode: "agent_session", agentServiceId: candidate.agentServiceId },
        );
        if (!admitted)
return null;
        const existing = await transaction.conversation.findUnique({
          where: { id: conversationId },
          select: {
            siloId: true,
            mode: true,
            agentServiceId: true,
            computerId: true,
            computerAgentIdentityId: true,
            computerProfileRevisionId: true,
          },
        });
        if (existing === null)
{
          await transaction.conversation.create({
            data: {
              id: conversationId,
              siloId: caller.siloId,
              mode: ConversationMode.AgentSession,
              agentServiceId: candidate.agentServiceId,
              computerId,
              computerAgentIdentityId: agentIdentityId,
              computerProfileRevisionId: candidate.profileRevisionId,
              participants: {
                create: [
                  {
                    userId: caller.subjectId,
                    visibleFromPosition: 1n,
                    readThroughPosition: 0n,
                  },
                ],
              },
            },
          });
        } else if (
          existing.siloId !== caller.siloId ||
          existing.mode !== ConversationMode.AgentSession ||
          existing.agentServiceId !== candidate.agentServiceId ||
          existing.computerId !== computerId ||
          existing.computerAgentIdentityId !== agentIdentityId ||
          existing.computerProfileRevisionId !== candidate.profileRevisionId
        )
          throw new Error(
            "Existing conversation projection conflicts with immutable history",
          );
        await authorization.reconcileParticipants(
          caller.siloId,
          conversationId,
          [caller.subjectId],
          caller.principalId,
          new Date(),
        );
        await authorization.reconcileCreator(
          caller.siloId,
          conversationId,
          caller.principalId,
          new Date(),
        );
        return conversationId;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

/** Derives an RFC 4122 version-five-shaped UUID from server-owned stable coordinates. */
function _DeterministicUuid(
  namespace: string,
  ...coordinates: readonly string[]
): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update([namespace, ...coordinates].join("\u0000"), "utf8")
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
