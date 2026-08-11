import { Injectable, InjectionToken, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ElicitationBodyKinds, type ConversationElicitation, type SubmitElicitationResponse } from "@opencrane/contracts";

import { ElicitationGatewayError, ElicitationGatewayErrorKinds } from "./elicitation-gateway.errors.js";
import type { ConversationElicitationGateway, GeneratedElicitationSubmission } from "./elicitation-gateway.types.js";
import { __ParseConversationElicitation, __ParseElicitationResponseProjection } from "./elicitation-response.validator.js";

/** Browser composition token for the elicitation port. */
export const ELICITATION_GATEWAY = new InjectionToken<ConversationElicitationGateway>("ELICITATION_GATEWAY", { providedIn: "root", factory: function _Factory() { return inject(OpenCraneConversationElicitationGateway); } });

/** Generated-client adapter over the signed-in generic elicitation API. */
@Injectable({ providedIn: "root" })
export class OpenCraneConversationElicitationGateway implements ConversationElicitationGateway
{
	/** Shared cookie-session API client. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async read(conversationId: string, requestId: string): Promise<ConversationElicitation>
	{
		const { data, error, response } = await this._api.client.GET("/me/conversations/{conversationId}/elicitations/{requestId}", { params: { path: { conversationId, requestId } } });
		if (error !== undefined || !response.ok || data === undefined) throw _Error(response.status, error);
		return __ParseConversationElicitation(data.elicitation);
	}

	/** @inheritdoc */
	public async respond(conversationId: string, requestId: string, submission: SubmitElicitationResponse)
	{
		const { data, error, response } = await this._api.client.POST("/me/conversations/{conversationId}/elicitations/{requestId}/responses", { params: { path: { conversationId, requestId } }, body: _GeneratedSubmission(submission) });
		if (error !== undefined || !response.ok || data === undefined) throw _Error(response.status, error);
		return __ParseElicitationResponseProjection(data.response);
	}

	/** @inheritdoc */
	public async listActivity(limit = 50): Promise<readonly ConversationElicitation[]>
	{
		const { data, error, response } = await this._api.client.GET("/me/activity/elicitations", { params: { query: { limit } } });
		if (error !== undefined || !response.ok || data === undefined) throw _Error(response.status, error);
		return data.elicitations.map(__ParseConversationElicitation);
	}
}

/** Copy the immutable domain response into the mutable generated transport shape. */
function _GeneratedSubmission(submission: SubmitElicitationResponse): GeneratedElicitationSubmission
{
	switch (submission.response.kind)
	{
		case ElicitationBodyKinds.Approval: return { idempotencyKey: submission.idempotencyKey, response: { kind: submission.response.kind, approved: submission.response.approved } };
		case ElicitationBodyKinds.SingleChoice: return { idempotencyKey: submission.idempotencyKey, response: { kind: submission.response.kind, selection: submission.response.selection } };
		case ElicitationBodyKinds.MultipleChoice: return { idempotencyKey: submission.idempotencyKey, response: { kind: submission.response.kind, selections: [...submission.response.selections] } };
		case ElicitationBodyKinds.FreeText: return { idempotencyKey: submission.idempotencyKey, response: { kind: submission.response.kind, text: submission.response.text } };
	}
}

/** Convert HTTP status and only the fixed step-up path into bounded browser state. */
function _Error(status: number, payload: unknown): ElicitationGatewayError
{
	if (status === 428) return new ElicitationGatewayError(ElicitationGatewayErrorKinds.StepUpRequired, _StepUpPath(payload));
	if (status === 403) return new ElicitationGatewayError(ElicitationGatewayErrorKinds.Forbidden);
	if (status === 409) return new ElicitationGatewayError(ElicitationGatewayErrorKinds.Conflict);
	return new ElicitationGatewayError(ElicitationGatewayErrorKinds.Unavailable);
}

/** Admit only the server's fixed same-origin reauthentication path. */
function _StepUpPath(payload: unknown): string
{
	if (payload !== null && typeof payload === "object" && !Array.isArray(payload) && (payload as Record<string, unknown>)["reauthenticatePath"] === "/api/v1/auth/reauthenticate") return "/api/v1/auth/reauthenticate";
	return "/api/v1/auth/reauthenticate";
}
