import { ConversationModes } from "@opencrane/models/conversations";

import { ConversationPersonalAgentStatuses, type ConversationCreationDirectory, type CreateConversationCommand } from "./conversation-workspace.types";

/**
 * Checks assistant availability or the human cardinality required by the selected conversation mode.
 * Called by: ConversationWorkspaceStore._CanCreate, which also guards its active request state.
 * @see ConversationCreationDirectory
 */
export function _CanCreateConversation(mode: ConversationModes, directory: ConversationCreationDirectory | null, selectedParticipantRefs: ReadonlySet<string>): boolean
{
	if (directory === null)
		return false;
	if (mode === ConversationModes.AgentSession)
		return directory.personalAgentStatus === ConversationPersonalAgentStatuses.Ready && directory.personalAgent !== null;
	if (mode === ConversationModes.Direct)
		return selectedParticipantRefs.size === 1;
	return selectedParticipantRefs.size >= 1;
}

/**
 * Reuses the pending UUID when the selected assistant or member set still matches the request.
 *
 * The workspace store owns command lifetime and calls this after validating creation choices.
 * Sorting member references makes a reordered selection the same request; a changed selection
 * receives a new UUID. The server remains responsible for admission and durable retry identity.
 *
 * Called by: ConversationWorkspaceStore._CreateCommand.
 * @see CreateConversationCommand
 */
export function _ResolveConversationCreationCommand(mode: ConversationModes, directory: ConversationCreationDirectory | null, selectedParticipantRefs: ReadonlySet<string>, pending: CreateConversationCommand | null): CreateConversationCommand | null
{
	if (directory === null)
		return null;
	if (mode === ConversationModes.AgentSession && directory.personalAgent !== null)
	{
		const personalAgentRef = directory.personalAgent.personalAgentRef;
		if (pending?.mode === mode && pending.personalAgentRef === personalAgentRef)
			return pending;
		return { mode, personalAgentRef, idempotencyKey: globalThis.crypto.randomUUID() };
	}
	if (mode === ConversationModes.Direct || mode === ConversationModes.Group)
	{
		const participantRefs = [...selectedParticipantRefs].sort();
		if (pending?.mode === mode && pending.participantRefs.length === participantRefs.length && pending.participantRefs.every((reference, index) => reference === participantRefs[index]))
			return pending;
		return { mode, participantRefs, idempotencyKey: globalThis.crypto.randomUUID() };
	}
	return null;
}
