import type { PrismaClient } from "@prisma/client";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { AgentSessionHistory } from "./agent-session-history";
import type { AgentSessionReleaseProfile, InitialConversationComputerResolver } from "./agent-session-creation.types";
import { _AgentSessionCoordinates } from "./agent-session-identifiers";
import { PrismaAgentSessionProjection } from "./agent-session-projection";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import type { ConversationCaller } from "../authorization/conversation-caller.types";

/** Accepts UUID command identifiers before any creation authority or history write. */
const _CREATE_COMMAND_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

	/**
	 * Creates a session for a new command, or recovers the same session after an uncertain response.
	 * Called by: PrismaConversationMetadataUnitOfWork.create.
	 * @param idempotencyKey UUID retained by the caller for every retry of this creation request.
	 * @returns The session id, or null when the command or current creation authority is unavailable.
	 * @throws When existing history conflicts with the requested agent or computer coordinates.
	 */
	public async resolve(caller: ConversationCaller, personalAgentRef: string, idempotencyKey: string): Promise<string | null>
	{
		if (!_CREATE_COMMAND_UUID.test(idempotencyKey))
			return null;
		// 1. Precheck mutable authority before creating immutable state.
		const candidate = await this.projection.precheck(caller, personalAgentRef);
		if (candidate === null)
			return null;
		// 2. Establish stable immutable coordinates and state.
		const coordinates = _AgentSessionCoordinates(caller, candidate.agentServiceId, idempotencyKey);
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
