import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { AgentIdentityStates, ConversationComputerStates, type AgentIdentity, type ConversationComputer } from "@opencrane/contracts";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationModes } from "@opencrane/models/conversations";
import type { AgentSessionCandidate, AgentSessionCoordinates } from "./agent-session-creation.types";
import { _DeterministicUuid } from "./agent-session-identifiers";
import { ConversationHistoryAuthority } from "./conversation-history-authority";
import { ConversationHistoryReader } from "./conversation-history-reader";
import { ConversationComputerHistory } from "./conversation-computers";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Owns immutable identity, genesis, and logical-computer establishment. */
export class AgentSessionHistory
{
	/** Validates agent identities. */
	private readonly identities: AgentIdentityHistory;
	/** Validates conversation genesis. */
	private readonly conversations: ConversationHistoryReader;
	/** Validates logical computers. */
	private readonly computers: ConversationComputerHistory;
	/** Connects every history operation to the same Kurrent store. */
	public constructor(private readonly store: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, private readonly authority: ConversationHistoryAuthority)
	{
		this.identities = new AgentIdentityHistory(store);
		this.conversations = new ConversationHistoryReader(store);
		this.computers = new ConversationComputerHistory(store);
	}

	/** Ensures the caller-bound identity and atomically creates genesis with its cold computer. */
	public async establish(caller: ConversationCaller, candidate: AgentSessionCandidate, coordinates: AgentSessionCoordinates): Promise<void>
	{
		await this._ensureIdentity(caller, candidate, coordinates.agentIdentityId);
		await this._ensureGenesisAndComputer(caller, candidate, coordinates);
	}

	/** Appends and verifies revision-zero history for an ordinary conversation. */
	public async createOrdinaryGenesis(caller: ConversationCaller, conversationId: string, mode: "direct" | "group"): Promise<void>
	{
		const genesis = { schemaVersion: 1 as const, conversationId, siloId: caller.siloId, mode, agentServiceId: null, createdByPrincipalId: caller.principalId, createdAt: new Date().toISOString() };
		const append = this.authority.genesisAppend(genesis, _DeterministicUuid("conversation-created", conversationId));
		await this.store.append(append);
		const history = await this.conversations.read({ siloId: caller.siloId, conversationId });
		if (history.genesis.mode !== mode || history.genesis.agentServiceId !== null || history.genesis.createdByPrincipalId !== caller.principalId)
			throw new Error("Conversation genesis does not match the ordinary creation request");
	}

	/** Creates or verifies one active proxied identity for the exact caller principal. */
	private async _ensureIdentity(caller: ConversationCaller, candidate: AgentSessionCandidate, agentIdentityId: string): Promise<void>
	{
		const command = { siloId: caller.siloId, agentIdentityId, agentServiceId: candidate.agentServiceId, principalId: caller.principalId };
		const existing = await this.identities.load(command);
		if (existing !== null)
		{
			await this.identities.loadActive(command);
			return;
		}
		const identity: AgentIdentity = { schemaVersion: 1, id: agentIdentityId, siloId: caller.siloId, agentServiceId: candidate.agentServiceId, name: candidate.agentName, avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: caller.principalId, createdAt: new Date().toISOString(), kind: "proxied", proxiedPrincipalId: caller.principalId, delegationPolicyId: "personal-agent-session-v1" };
		try
		{
			await this.identities.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: _DeterministicUuid("agent-identity-created", agentIdentityId), identity });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		await this.identities.loadActive(command);
	}

	/** Atomically creates or verifies the immutable session genesis and initial computer. */
	private async _ensureGenesisAndComputer(caller: ConversationCaller, candidate: AgentSessionCandidate, coordinates: AgentSessionCoordinates): Promise<void>
	{
		const now = new Date().toISOString();
		const genesis = { schemaVersion: 1 as const, conversationId: coordinates.conversationId, siloId: caller.siloId, mode: "agent_session" as const, agentServiceId: candidate.agentServiceId, createdByPrincipalId: caller.principalId, createdAt: now };
		const computer: ConversationComputer = { schemaVersion: 1, id: coordinates.computerId, siloId: caller.siloId, conversationId: coordinates.conversationId, agentIdentityId: coordinates.agentIdentityId, profileRevisionId: candidate.profileRevisionId, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: now, updatedAt: now };
		const genesisAppend = this.authority.genesisAppend(genesis, _DeterministicUuid("conversation-created", coordinates.conversationId));
		const computerAppend = { streamName: `conversation-computer-${coordinates.computerId}`, expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: _DeterministicUuid("conversation-computer-created", coordinates.computerId), type: "opencrane.conversation-computer.v1", data: { computer, lease: null }, metadata: { siloId: caller.siloId, computerId: coordinates.computerId, conversationId: coordinates.conversationId, agentIdentityId: coordinates.agentIdentityId, profileRevisionId: candidate.profileRevisionId, leaseId: null, leaseGeneration: null, leaseState: null } }] };
		try
		{
			await this.store.appendAtomic({ expectedHeads: [{ streamName: genesisAppend.streamName, revision: HistoryExpectedRevisions.NoStream }, { streamName: computerAppend.streamName, revision: HistoryExpectedRevisions.NoStream }], appends: [genesisAppend, computerAppend] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		const history = await this.conversations.read({ siloId: caller.siloId, conversationId: coordinates.conversationId });
		if (history.genesis.mode !== ConversationModes.AgentSession || history.genesis.agentServiceId !== candidate.agentServiceId || history.genesis.createdByPrincipalId !== caller.principalId)
			throw new Error("Existing conversation genesis does not match the requested agent session");
		const current = await this.computers.load({ siloId: caller.siloId, computerId: coordinates.computerId, conversationId: coordinates.conversationId, agentIdentityId: coordinates.agentIdentityId, profileRevisionId: candidate.profileRevisionId });
		if (current === null || current.computer.state !== ConversationComputerStates.Cold || current.computer.leaseGeneration !== 1 || current.lease !== null)
			throw new Error("Conversation creation requires one cold generation-one computer");
	}
}
