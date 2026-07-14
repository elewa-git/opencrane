import { UiCitationScope, UiMessage, UiMessageRole, UiMessageStatus, UiSessionState } from "../../models/session.types.js";

/** Creates a fresh default Session state so tests never share mutable fixture references. */
export function _DefaultSessionState(): UiSessionState
{
	return {
		sessions:
		[
			{ id: "session-strategy", title: "Q3 strategy review", scope: "Product", owned: true, unread: 2, active: true },
			{ id: "session-research", title: "Customer research synthesis", scope: "Research", owned: true, active: false },
			{ id: "session-shared", title: "Launch readiness", scope: "Company", owned: false, active: false }
		],
		selectedSessionId: "session-strategy",
		messages: _DefaultMessages(),
		model: "Claude Sonnet 4.6",
		contractSummary: "contract v2.3.1 · org · dept · project · personal",
		connected: true
	};
}

/** Creates fresh default messages for the selected mock Session. */
function _DefaultMessages(): readonly UiMessage[]
{
	return [
		{
			id: "message-assistant-1",
			role: UiMessageRole.Assistant,
			content: "I reviewed the launch plan and found three decisions that need an owner before Friday.",
			status: UiMessageStatus.Complete,
			citations:
			[
				{ id: "citation-1", type: "P", title: "Launch readiness plan", scope: UiCitationScope.Project, source: "project/launch", status: "applied" }
			]
		},
		{
			id: "message-user-1",
			role: UiMessageRole.User,
			content: "Summarize those decisions and propose next steps.",
			status: UiMessageStatus.Complete,
			citations: []
		},
		{
			id: "message-tool-1",
			role: UiMessageRole.Tool,
			content: "Reviewed 12 launch documents",
			status: UiMessageStatus.Complete,
			citations: [],
			toolName: "Workspace search"
		}
	];
}
