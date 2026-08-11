import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";

/** Structural cursorless overlay reader consumed by the conversation replay package. */
export interface ElicitationInterruptReader
{
	/** Read current requests for one exact active participant and conversation. */
	readOpen(command: { readonly conversationId: string; readonly siloId: string; readonly subjectId: string }): Promise<readonly AgUiProjectionSourceEvent[]>;
}
