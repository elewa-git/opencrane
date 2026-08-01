import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { __CreateAgUiStreamState, __DecodeAgUiSseRecord, __ReduceAgUiStream, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

import type { ConversationReplayReader } from "./conversation-replay-reader.types.js";

/** Read one finite canonical AG-UI SSE response into display-safe browser state. */
export function __ReadConversationReplay(body: string): AgUiStreamState
{
	let state = __CreateAgUiStreamState();
	if (body.length === 0) return state;
	for (const frame of body.split(/\r?\n\r?\n/u))
	{
		if (frame.trim().length === 0) continue;
		const record = __DecodeAgUiSseRecord(frame);
		if (record === null) throw new Error("invalid canonical conversation replay");
		state = __ReduceAgUiStream(state, record);
	}
	return state;
}

/** Cookie-session reader for the owner-bound canonical conversation replay endpoint. */
@Injectable()
export class OpenCraneConversationReplayReader implements ConversationReplayReader
{
	/** Generated Control Plane client carrying the browser's existing session cookie. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async replay(threadId: string, cursor?: string): Promise<AgUiStreamState>
	{
		if (threadId.trim().length === 0) throw new Error("conversation thread id is required");
		const { data, error } = await this._api.client.GET("/me/conversations/{threadId}/events", {
			params: {
				path: { threadId },
				...(cursor === undefined ? {} : { query: { cursor }, header: { "Last-Event-ID": cursor } })
			},
			parseAs: "text"
		});
		if (error || data === undefined) throw new Error("canonical conversation replay is unavailable");
		return __ReadConversationReplay(data);
	}
}
