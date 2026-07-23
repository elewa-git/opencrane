import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";

import { __ProjectConversationReplayEvent } from "./replay-projection.js";
import type { ConversationReplayRepository, ReadConversationReplayCommand } from "./replay-reader.types.js";

/** Read one bounded, redacted canonical replay snapshot through an already-authorised port. */
export async function __ReadConversationReplay(repository: ConversationReplayRepository, command: ReadConversationReplayCommand): Promise<readonly AgUiProjectionSourceEvent[]>
{
	if (!command.threadId || !command.siloId || !command.subjectId || !Number.isSafeInteger(command.limit) || command.limit < 1 || command.limit > 500) return [];
	const rows = await repository.read(command);
	return rows.slice(0, command.limit).map(__ProjectConversationReplayEvent).filter(function _present(event): event is AgUiProjectionSourceEvent { return event !== null; });
}
