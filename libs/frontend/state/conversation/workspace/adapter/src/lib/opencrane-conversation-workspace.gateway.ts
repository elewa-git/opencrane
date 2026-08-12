import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationRunStates, ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds, type ConversationCreationDirectory, type ConversationRun, type ConversationSummary, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway, type CreateConversationCommand, type RetryConversationRunCommand, type SubmitConversationMessageCommand, type SubmitConversationSteeringCommand } from "@opencrane/state/conversation/workspace";

import { _ConversationDetail, _ConversationRun, _ConversationSummary, _ConversationWorkspaceDirectory } from "./conversation-workspace.dto.js";
import type { ConversationDetailDto, ConversationDirectoryDto, ConversationRunDto, ConversationSummaryDto } from "./conversation-workspace.dto.types.js";

/** Generated-client adapter for participant-scoped workspace reads and commands. */
@Injectable()
export class OpenCraneConversationWorkspaceGateway implements ConversationWorkspaceGateway
{
	/** Cookie-authenticated Control Plane client. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async directory(): Promise<ConversationCreationDirectory>
	{
		const result = await this._api.client.GET("/me/conversations/directory");
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationWorkspaceDirectory(result.data.directory as ConversationDirectoryDto); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async list(): Promise<readonly ConversationSummary[]>
	{
		const result = await this._api.client.GET("/me/conversations", { params: { query: { includeArchived: false } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return result.data.conversations.map(function _Summary(dto) { return _ConversationSummary(dto as ConversationSummaryDto); }); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async open(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		const result = await this._api.client.GET("/me/conversations/{conversationId}", { params: { path: { conversationId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation as ConversationDetailDto); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async create(command: CreateConversationCommand): Promise<ConversationWorkspaceDetail>
	{
		const body = "participantRefs" in command ? { ...command, participantRefs: [...command.participantRefs] } : command;
		const result = await this._api.client.POST("/me/conversations", { body });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation as ConversationDetailDto); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async send(command: SubmitConversationMessageCommand): Promise<void>
	{
		const blocks = command.blocks.map(function _Block(block) { return { ...block }; });
		const result = await this._api.client.POST("/me/conversations/{conversationId}/messages", { params: { path: { conversationId: command.conversationId } }, body: { idempotencyKey: command.idempotencyKey, blocks } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
	}

	/** @inheritdoc */
	public async archive(conversationId: string, archived: boolean): Promise<ConversationWorkspaceDetail>
	{
		const result = await this._api.client.PATCH("/me/conversations/{conversationId}/archive", { params: { path: { conversationId } }, body: { archived } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation as ConversationDetailDto); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async close(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		const result = await this._api.client.POST("/me/conversations/{conversationId}/close", { params: { path: { conversationId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation as ConversationDetailDto); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async run(runId: string): Promise<ConversationRun>
	{
		const result = await this._api.client.GET("/me/runs/{runId}", { params: { path: { runId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationRun(result.data as ConversationRunDto); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async steer(command: SubmitConversationSteeringCommand): Promise<void>
	{
		const result = await this._api.client.POST("/me/runs/{runId}/steering", { params: { path: { runId: command.runId } }, body: { text: command.text, idempotencyKey: command.idempotencyKey } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
	}

	/** @inheritdoc */
	public async cancel(runId: string, expectedAttempt: number): Promise<ConversationRun>
	{
		const result = await this._api.client.POST("/me/runs/{runId}/cancellation", { params: { path: { runId } }, body: { expectedAttempt } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		const state = result.data.state === ConversationRunStates.Cancelling ? ConversationRunStates.Cancelling : ConversationRunStates.Cancelled;
		return { runId: result.data.runId, attempt: result.data.attempt, state, conversationId: null };
	}

	/** @inheritdoc */
	public async retry(command: RetryConversationRunCommand): Promise<ConversationRun>
	{
		const result = await this._api.client.POST("/me/conversations/{conversationId}/runs/{runId}/retry", { params: { path: { conversationId: command.conversationId, runId: command.runId } }, body: { expectedAttempt: command.expectedAttempt, idempotencyKey: command.idempotencyKey } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		return { runId: result.data.runId, attempt: result.data.attempt, state: ConversationRunStates.Accepted, conversationId: command.conversationId };
	}
}

/** Collapse transport status into browser-safe categories without copying response bodies. */
function _Failure(status: number | undefined): ConversationWorkspaceGatewayError
{
	if (status === 401 || status === 403 || status === 404) return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This conversation is no longer available.");
	if (status === 409) return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "This conversation changed. Refresh and try again.");
	if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Recoverable, "OpenCrane could not complete that action. Try again.");
	return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Unavailable, "The conversation workspace is unavailable.");
}

/** Build one safe invalid-response failure after runtime mapping rejects a generated payload. */
function _InvalidResponse(): ConversationWorkspaceGatewayError
{
	return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Recoverable, "OpenCrane returned an invalid conversation response. Try reconnecting.");
}
