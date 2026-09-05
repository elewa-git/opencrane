import type { PrismaClient } from "@prisma/client";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { AgentSessionHistory } from "./agent-session-history";
import type { AgentSessionReleaseProfile, InitialConversationComputerResolver } from "./agent-session-creation.types";
import { _AgentSessionCoordinates } from "./agent-session-identifiers";
import { PrismaAgentSessionProjection } from "./agent-session-projection";
import { ConversationHistoryAuthority } from "./conversation-history-authority";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Coordinates Kurrent-first session creation without owning either persistence boundary. */
export class PrismaAgentSessionCreationUnitOfWork implements InitialConversationComputerResolver
{
	/** Owns relational authorization and projections. */
	private readonly projection: PrismaAgentSessionProjection;
	/** Owns immutable identity and computer history. */
	private readonly history: AgentSessionHistory;

	/** Connects the explicit relational and history owners used by creation. */
	public constructor(prisma: PrismaClient, historyStore: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, profiles: readonly AgentSessionReleaseProfile[])
	{
		this.projection = new PrismaAgentSessionProjection(prisma, profiles);
		const conversationHistory = new ConversationHistoryAuthority(historyStore);
		this.history = new AgentSessionHistory(historyStore, conversationHistory);
	}

	/** Establishes Kurrent state before installing its authorized projection. */
	public async resolve(caller: ConversationCaller, personalAgentRef: string): Promise<string | null>
	{
		// 1. Precheck mutable authority before creating immutable state.
		const candidate = await this.projection.precheck(caller, personalAgentRef);
		if (candidate === null)
			return null;
		// 2. Establish stable immutable coordinates and state.
		const coordinates = _AgentSessionCoordinates(caller, candidate.agentServiceId);
		await this.history.establish(caller, candidate, coordinates);
		// 3. Recheck authority serializably and rebuild the projection.
		return this.projection.project(caller, candidate, coordinates);
	}

	/** Delegates ordinary genesis creation to the history owner. */
	public createOrdinaryGenesis(caller: ConversationCaller, conversationId: string, mode: "direct" | "group"): Promise<void>
	{
		return this.history.createOrdinaryGenesis(caller, conversationId, mode);
	}
}
