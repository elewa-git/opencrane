import { ConversationComputerParticipantInputAuthority } from "./conversation-computer-participant-input-authority";
import type { ConversationComputerParticipantInputAdmissionResult, ConversationComputerParticipantInputAuthorizer, ConversationComputerParticipantInputRequest } from "./conversation-computer-participant-input-admission.types";
import type { ConversationCaller } from "../types/conversation-caller.types";

/**
 * Joins current PostgreSQL authorization to the history-first participant-input authority.
 *
 * The authorizer owns mutable membership and product policy, while
 * {@link ConversationComputerParticipantInputAuthority} owns the immutable append and replay
 * check. Separating those responsibilities gives the public transport one target owner without
 * returning to the removed AgentRun admission transaction.
 *
 * Called by: the fresh Agent-session HTTP and socket input compositions.
 * @see ConversationComputerParticipantInputAuthority for durable input retention.
 */
export class ConversationComputerParticipantInputAdmission
{
	/** Connects current authorization to the immutable participant-input writer. */
	public constructor(private readonly authorizer: ConversationComputerParticipantInputAuthorizer, private readonly inputs: Pick<ConversationComputerParticipantInputAuthority, "admit">)
	{
	}

	/**
	 * Authorizes one current participant and writes its opaque history input only when authorized.
	 *
	 * Every retry re-evaluates mutable permission before the history authority sees its UUID. A
	 * revoked participant therefore cannot use an old request key to inspect or replay an entry.
	 *
	 * @param caller - Supplies the request principal resolved by the authenticated transport.
	 * @param conversationId - Names the one agent-session conversation selected by the route.
	 * @param request - Supplies the target UUID retry key and text body.
	 * @returns The immutable input result, or `null` when current authority denies the submission.
	 */
	public async admit(caller: ConversationCaller, conversationId: string, request: ConversationComputerParticipantInputRequest): Promise<ConversationComputerParticipantInputAdmissionResult>
	{
		const authorized = await this.authorizer.authorize(caller, conversationId, request);
		if (authorized === null)
			return null;
		return this.inputs.admit({ siloId: caller.siloId, conversationId, computerId: authorized.computerId, inputId: request.inputId, text: request.text, author: authorized.author });
	}
}
