/**
 * Completes the server-owned persona state machine by choosing the first reviewed answer or tie
 * candidate the API presents. The qualification follows current product transitions instead of
 * embedding a second scoring policy in the development script.
 * @throws When the server returns incomplete evidence, an unsupported state, or too many steps.
 */
export async function completeTier3Persona(request)
{
	for (let transition = 0; transition < 16; transition += 1)
	{
		const status = (await request("GET", "/api/v1/me/persona")).body;
		if (status?.state === "ready")
			return;
		if (status?.state === "interview")
		{
			if (typeof status.interviewId !== "string")
				await request("POST", "/api/v1/me/persona/interview", {});
			else
			{
				for (const question of status.questions ?? [])
				{
					if (question.selectedChoiceId !== null)
						continue;
					const choiceId = question.choices?.[0]?.id;
					if (typeof question.id !== "string" || typeof choiceId !== "string")
						throw new Error("Tier 3 persona question has no reviewed choice.");
					await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/answers/${encodeURIComponent(question.id)}`, { choiceId });
				}
				await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/complete`, {});
			}
		}
		else if (status?.state === "resolution")
		{
			const selectedValue = status.resolution?.candidates?.[0];
			if (typeof status.interviewId !== "string" || typeof status.resolution?.kind !== "string" || typeof selectedValue !== "string")
				throw new Error("Tier 3 persona tie has no reviewed resolution candidate.");
			await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/resolutions/${encodeURIComponent(status.resolution.kind)}`, { selectedValue });
		}
		else if (status?.state === "review")
		{
			if (typeof status.interviewId !== "string")
				throw new Error("Tier 3 persona review has no interview evidence.");
			if (typeof status.personaRevisionId === "string")
				await request("POST", `/api/v1/me/persona/drafts/${encodeURIComponent(status.personaRevisionId)}/approve`, {});
			else
				await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/draft`, {});
		}
		else
			throw new Error(`Tier 3 persona returned unsupported state ${String(status?.state)}.`);
	}
	throw new Error("Tier 3 persona journey exceeded its transition limit.");
}

/**
 * Answers the three questions selected by the guided-onboarding API and concludes the same chat.
 * The development proof supplies stable test prose but lets the server own question order.
 * @throws When the API omits its conversation position or refuses conclusion.
 */
export async function completeTier3BootstrapChat(request, uuid)
{
	let chat = (await request("GET", "/api/v1/me/onboarding/chat")).body;
	if (chat?.state === "bootstrap_chat_pending")
		chat = (await request("POST", "/api/v1/me/onboarding/chat/start", {})).body;
	for (let answer = 0; answer < 3 && chat?.currentQuestion !== null; answer += 1)
	{
		if (typeof chat?.conversationId !== "string" || !Number.isSafeInteger(chat.currentQuestion?.ordinal))
			throw new Error("Tier 3 onboarding chat did not expose its current server-selected question.");
		chat = (await request("POST", "/api/v1/me/onboarding/chat/answers", { expectedConversationId: chat.conversationId, expectedQuestionOrdinal: chat.currentQuestion.ordinal, text: "Use concise, evidence-backed answers and ask before taking irreversible actions.", idempotencyKey: uuid() })).body;
	}
	if (chat?.canConclude !== true)
		throw new Error("Tier 3 onboarding chat did not become concludable after its reviewed questions.");
	const completed = (await request("POST", "/api/v1/me/onboarding/chat/conclude", {})).body;
	if (completed?.state !== "completed")
		throw new Error("Tier 3 onboarding completion was not admitted.");
}

/**
 * Reads the personal Agent that onboarding published for the development identity.
 * @returns The reference required to create the qualification conversation.
 * @throws When onboarding has not produced a ready personal Agent.
 */
export async function readTier3PersonalAgent(request)
{
	const directory = (await request("GET", "/api/v1/me/conversations/directory")).body?.directory;
	const personalAgentRef = directory?.personalAgent?.personalAgentRef;
	if (directory?.personalAgentStatus !== "ready" || typeof personalAgentRef !== "string" || !personalAgentRef)
		throw new Error("Tier 3 personal agent is not ready after onboarding.");
	return personalAgentRef;
}
