import type { GroupChildCreateCommand, GroupChildRequest, GroupChildShareCommand, GroupChildView } from "../group-child.types";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { StoredConversationPrivatePayload } from "../../messages/db/prisma-conversation-history-repository.types";

/** Owns the relational stages of admitted child creation and human-reviewed sharing. */
export interface GroupChildRequestRepository
{
	create(caller: ConversationCaller, parentId: string, command: GroupChildCreateCommand, id: string, digest: string): Promise<GroupChildView | null>;
	list(caller: ConversationCaller, parentId: string): Promise<readonly GroupChildView[] | null>;
	find(id: string): Promise<GroupChildRequest | null>;
	setState(request: GroupChildRequest, state: GroupChildRequest["state"]): Promise<void>;
	current(request: GroupChildRequest): Promise<boolean>;
	canCreate(caller: ConversationCaller, parentId: string, command: GroupChildCreateCommand, id: string, digest: string): Promise<boolean>;
	project(request: GroupChildRequest): Promise<boolean>;
	prepareInput(request: GroupChildRequest, text: string): Promise<StoredConversationPrivatePayload | null>;
	shareRequest(caller: ConversationCaller, childId: string): Promise<GroupChildRequest | null>;
	prepareShare(caller: ConversationCaller, request: GroupChildRequest, command: GroupChildShareCommand, digest: string, payloadRef: string): Promise<{ readonly payload: StoredConversationPrivatePayload; readonly authorName: string } | null>;
	canShare(caller: ConversationCaller, childId: string, parentId: string): Promise<boolean>;
}
