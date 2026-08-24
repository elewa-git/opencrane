import { Injectable, inject } from "@angular/core";

import { ElicitationRequestStates, type ConversationElicitation, type ElicitationResponseProjection, type SubmitElicitationResponse } from "@opencrane/contracts";
import type { ConversationElicitationGateway } from "@opencrane/state/conversation/elicitation";

import { LocalDevelopmentState } from "./local-development-state";

/**
 * Implements participant approval reads and responses against shared Tier 1 state. Saving the
 * answer in that state makes the same terminal request appear in later detail and Activity reads.
 */
@Injectable()
export class LocalDevelopmentConversationElicitationGateway implements ConversationElicitationGateway
{
	/** Shared state linking the approval request to the local Agent run. */
	private readonly _state = inject(LocalDevelopmentState);

	/** Read the active local approval when both route identifiers match. */
	public async read(conversationId: string, requestId: string): Promise<ConversationElicitation>
	{
		const elicitation = this._state.elicitation;

		if (elicitation.conversationId !== conversationId || elicitation.requestId !== requestId)
		{
			throw new Error("The approval is unavailable.");
		}

		return elicitation;
	}

	/** Store the decision so later detail and Activity reads show the answered request. */
	public async respond(conversationId: string, requestId: string, _submission: SubmitElicitationResponse): Promise<ElicitationResponseProjection>
	{
		const elicitation = await this.read(conversationId, requestId);
		this._state.failOnce("elicitation-response");
		const resolvedAt = "2026-08-21T10:15:00.000Z";
		this._state.elicitation = { ...elicitation, state: ElicitationRequestStates.Answered, resolvedAt, safeReason: "The local response was saved." };
		return { requestId, state: ElicitationRequestStates.Answered, idempotent: false, resolvedAt };
	}

	/** Return the local approval as Activity history when the caller requests at least one row. */
	public async listActivity(limit = 50): Promise<readonly ConversationElicitation[]>
	{
		return limit > 0 ? [this._state.elicitation] : [];
	}
}
