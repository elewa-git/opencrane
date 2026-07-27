import type { AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

/** Reads one signed-in participant's bounded canonical conversation replay. */
export interface ConversationReplayReader
{
	/**
	 * Read and validate one bounded replay page for `threadId`.
	 *
	 * @param threadId - Opaque canonical conversation-thread identifier.
	 * @param cursor - Opaque server-issued resume cursor, when continuing a prior replay.
	 * @returns The display-safe browser state reduced from the authoritative SSE response.
	 */
	replay(threadId: string, cursor?: string): Promise<AgUiStreamState>;
}
