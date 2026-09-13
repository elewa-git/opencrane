import { GroupChildStates, type GroupChildOrigin, type GroupChildView, type GroupChildRequest } from "./group-child.types";
import type { ConversationCaller } from "../authorization/conversation-caller.types";

/** Maps durable command state without suggesting that a ready child's model run has completed. */
const _STATES: Readonly<Record<GroupChildRequest["state"], GroupChildStates>> = { Pending: GroupChildStates.Pending, Ready: GroupChildStates.Ready, Unavailable: GroupChildStates.Unavailable };

/** Restores the original verified requester coordinates; every use still requires current authority. */
export function _GroupChildCaller(request: GroupChildRequest): ConversationCaller
{
	return { siloId: request.siloId, principalId: request.requestedByPrincipalId, subjectId: request.requesterSubjectId, externalIssuer: request.requesterIssuer, verifiedAuthenticationAt: request.requesterAuthenticatedAt.toISOString() };
}

/** Produces the immutable Kurrent origin binding from the admitted command. */
export function _RequestOrigin(request: GroupChildRequest): GroupChildOrigin
{
	return { requestId: request.id, parentConversationId: request.parentConversationId, parentMessageId: request.parentMessageId, parentMessagePosition: request.parentMessagePosition.toString() };
}

/** Exposes only child navigation and creation state, after its caller has checked access. */
export function _GroupChildView(request: GroupChildRequest): GroupChildView
{
	return { conversationId: request.childConversationId, parentConversationId: request.parentConversationId, parentMessageId: request.parentMessageId, parentMessagePosition: request.parentMessagePosition.toString(), state: _STATES[request.state], agentName: request.agentName };
}
