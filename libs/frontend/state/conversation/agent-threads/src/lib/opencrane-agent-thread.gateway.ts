import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { AgentThreadGatewayError, AgentThreadGatewayErrorKinds } from "./agent-thread-gateway.errors.js";
import { __AgentThreadSnapshot } from "./opencrane-agent-thread.mapper.js";
import type { AgentThreadGateway, AgentThreadSnapshot } from "./agent-thread.types.js";

/** Generated-client adapter for exact Agent-thread snapshot reads and serial follow-ups. */
@Injectable()
export class OpenCraneAgentThreadGateway implements AgentThreadGateway
{
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async read(parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshot>
	{
		const result = await this._api.client.GET("/me/conversations/{parentConversationId}/agent-threads/{childConversationId}", { params: { path: { parentConversationId, childConversationId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return __AgentThreadSnapshot(result.data.agentThread); }
		catch { throw new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.Recoverable, "OpenCrane returned an invalid Agent thread. Try reconnecting."); }
	}

	/** @inheritdoc */
	public async sendFollowUp(parentConversationId: string, childConversationId: string, body: string, idempotencyKey: string): Promise<AgentThreadSnapshot>
	{
		const result = await this._api.client.POST("/me/conversations/{conversationId}/messages", { params: { path: { conversationId: childConversationId } }, body: { idempotencyKey, blocks: [{ id: globalThis.crypto.randomUUID(), kind: MessageContentBlockKinds.Text, value: body }] } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		return this.read(parentConversationId, childConversationId);
	}
}

/** Collapse transport status into browser-safe categories without copying response bodies. */
function _Failure(status: number | undefined): AgentThreadGatewayError
{
	if (status === 401 || status === 403 || status === 404) return new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.AccessChanged, "This Agent thread is no longer available.");
	if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.Recoverable, "OpenCrane could not reach this Agent thread. Try reconnecting.");
	return new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.Unavailable, "This Agent thread is unavailable.");
}
