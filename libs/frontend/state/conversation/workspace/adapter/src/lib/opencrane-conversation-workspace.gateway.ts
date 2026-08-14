import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationRunStates, ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds, type ConversationCreationDirectory, type ConversationOnboardingHistoryProjection, type ConversationRun, type ConversationSummary, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway, type CreateConversationCommand, type RetryConversationRunCommand, type SubmitConversationMessageCommand, type SubmitConversationSteeringCommand } from "@opencrane/state/conversation/workspace";

import { _ConversationDetail, _ConversationOnboardingHistory, _ConversationRun, _ConversationSummary, _ConversationWorkspaceDirectory } from "./conversation-workspace.dto.js";

/**
 * Talks to the signed-in Control Plane API on behalf of the conversation workspace.
 *
 * This is the one class allowed to see the generated OpenAPI client. Everything above it works in the
 * types `@opencrane/state/conversation/workspace` declares, so a change to a response shape stops here.
 *
 * Two rules hold for every method. A successful body is run through that package's validator before any
 * of it reaches browser state, so an unexpected payload can never become UI state. A failure becomes a
 * {@link ConversationWorkspaceGatewayError} carrying fixed display copy — never a status code and never
 * anything copied out of the response body, which the package README makes a rule of this adapter.
 *
 * Identity comes from the browser session cookie the client already carries. No method takes a subject
 * id, so none of them can be aimed at another user's conversations.
 *
 * Called by: nothing directly. apps/opencrane-ui/src/app/chats/conversation-workspace.providers.ts binds
 * it as the `CONVERSATION_WORKSPACE_GATEWAY` implementation, and {@link ConversationWorkspaceStore},
 * ConversationRunStore and ConversationOnboardingHistoryStore call it through that token.
 *
 * @implements ConversationWorkspaceGateway
 * @see ConversationWorkspaceGatewayErrorKinds — the four categories every failure is reduced to.
 */
@Injectable()
export class OpenCraneConversationWorkspaceGateway implements ConversationWorkspaceGateway
{
	/** Generated client whose requests carry the browser session cookie; it supplies the caller's identity. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async directory(): Promise<ConversationCreationDirectory>
	{
		const result = await this._api.client.GET("/me/conversations/directory");
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationWorkspaceDirectory(result.data.directory); }
		catch { throw _InvalidResponse(); }
	}

	/**
	 * @inheritdoc
	 *
	 * Asks for archived rows as well. The feature draws them under their own "Archived" heading in the
	 * conversation list instead of dropping them, so archiving a chat moves it down the list rather than
	 * making it disappear — the behaviour asserted by "moves an archived conversation into history
	 * immediately" in conversation-workspace.store.spec.ts. The adapter README records the same rule.
	 */
	public async list(): Promise<readonly ConversationSummary[]>
	{
		const result = await this._api.client.GET("/me/conversations", { params: { query: { includeArchived: true } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return result.data.conversations.map(_ConversationSummary); }
		catch { throw _InvalidResponse(); }
	}

	/**
	 * @inheritdoc
	 *
	 * Reads the onboarding projection, whose body is the snapshot itself rather than a wrapper object like
	 * the conversation reads above, which is why the whole `result.data` is handed to the mapper.
	 *
	 * A rejected body becomes a recoverable error rather than a hard failure, so
	 * {@link ConversationOnboardingHistoryStore.load} can report the history as unavailable while the rest
	 * of the workspace still loads.
	 *
	 * @see _ConversationOnboardingHistory — which statuses a valid body can produce.
	 */
	public async onboardingHistory(): Promise<ConversationOnboardingHistoryProjection>
	{
		const result = await this._api.client.GET("/me/onboarding/chat");
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationOnboardingHistory(result.data); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async open(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		const result = await this._api.client.GET("/me/conversations/{conversationId}", { params: { path: { conversationId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async create(command: CreateConversationCommand): Promise<ConversationWorkspaceDetail>
	{
		const body = "participantRefs" in command ? { ...command, participantRefs: [...command.participantRefs] } : command;
		const result = await this._api.client.POST("/me/conversations", { body });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation); }
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
		try { return _ConversationDetail(result.data.conversation); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async close(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		const result = await this._api.client.POST("/me/conversations/{conversationId}/close", { params: { path: { conversationId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationDetail(result.data.conversation); }
		catch { throw _InvalidResponse(); }
	}

	/** @inheritdoc */
	public async run(runId: string): Promise<ConversationRun>
	{
		const result = await this._api.client.GET("/me/runs/{runId}", { params: { path: { runId } } });
		if (result.error !== undefined || result.data === undefined) throw _Failure(result.response?.status);
		try { return _ConversationRun(result.data); }
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

/**
 * Turns an HTTP status into the one of four categories the browser is allowed to see.
 *
 * The categories are grouped by what the caller should do next, not by status number. 401, 403 and 404
 * all mean the same thing to the workspace — you can no longer see this — and `ConversationWorkspaceStore`
 * responds to all three identically, by clearing the selected conversation and showing its access-changed
 * state. `Conflict` means reload and try again, `Recoverable` means the same request may still succeed,
 * and `Unavailable` covers a request that never got an answer at all.
 *
 * Nothing from the response body reaches the message.
 *
 * Called by: every method on {@link OpenCraneConversationWorkspaceGateway}.
 *
 * @param status - The HTTP status, or undefined when no response arrived.
 * @returns The error for the caller to throw; this function builds it and never throws itself.
 */
function _Failure(status: number | undefined): ConversationWorkspaceGatewayError
{
	if (status === 401 || status === 403 || status === 404) return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This conversation is no longer available.");
	if (status === 409) return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "This conversation changed. Refresh and try again.");
	if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Recoverable, "OpenCrane could not complete that action. Try again.");
	return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Unavailable, "The conversation workspace is unavailable.");
}

/**
 * Builds the error used when a response did arrive but a validator rejected its contents.
 *
 * It is `Recoverable` rather than `Unavailable` because the workspace itself is reachable, so a retry or
 * a reconnect can still work. The validator's own message is dropped in favour of fixed copy, keeping to
 * the rule that no part of a response reaches the user.
 *
 * Called by: every method on {@link OpenCraneConversationWorkspaceGateway} that maps a body.
 *
 * @returns The recoverable error the caller throws in place of the rejected body.
 */
function _InvalidResponse(): ConversationWorkspaceGatewayError
{
	return new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Recoverable, "OpenCrane returned an invalid conversation response. Try reconnecting.");
}
