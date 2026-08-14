import { ConversationLifecycles, ConversationModes } from "@opencrane/contracts";
import { __AuthorizationScopesEqual } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { AuthorizeChannelActionsCommand, ChannelActionAuthorizationDecision, ChannelConversationAuthority } from "./channel-target-resolution.types";

/** Authorize one participant-bound conversation read and digest the exact accepted evidence. */
export function __AuthorizeConversationRead(conversation: ChannelConversationAuthority, command: AuthorizeChannelActionsCommand): ChannelActionAuthorizationDecision
{
	// 1. Require the sole supported action and organization scope before any evidence can be digested.
	if (command.requiredActions.length !== 1 || command.requiredActions[0] !== "conversation.read") return { outcome: "denied", reason: "action_not_allowed" };
	if (!__AuthorizationScopesEqual(command.scope, { kind: "organization", organizationId: command.siloId })) return { outcome: "denied", reason: "scope_mismatch" };

	// 2. Bind the decision to one current open agent session and its immutable service coordinates.
	if (conversation.mode !== ConversationModes.AgentSession
		|| conversation.lifecycle !== ConversationLifecycles.Open
		|| conversation.conversationId !== command.conversationId
		|| conversation.siloId !== command.siloId
		|| conversation.agentServiceId !== command.agentServiceId)
	{
		return { outcome: "denied", reason: "conversation_mismatch" };
	}

	// 3. Require explicit continuing participation and current signed membership evidence.
	if (!conversation.participantUserIds.includes(command.subjectId)) return { outcome: "denied", reason: "participant_unavailable" };
	if (!Number.isSafeInteger(command.membershipRevision) || command.membershipRevision < 1 || !Number.isSafeInteger(command.nowEpochMs) || command.nowEpochMs < 0) return { outcome: "denied", reason: "membership_unavailable" };

	const evidence = {
		policy: "conversation.read/v1",
		action: "conversation.read",
		agentServiceId: command.agentServiceId,
		conversationId: command.conversationId,
		membershipRevision: command.membershipRevision,
		scope: command.scope,
		siloId: command.siloId,
		subjectId: command.subjectId,
	} as unknown as JsonValue;
	return { outcome: "allowed", authorizationDigest: ___DigestCanonicalJson(evidence) };
}
