const _ANSWER_POLL_LIMIT = 150;
const _POLL_INTERVAL_MILLISECONDS = 2_000;
const _ANSWER_TIMEOUT_MILLISECONDS = 300_000;

/**
 * Polls immutable conversation history for the completed Agent reply linked to the submitted
 * message. Uncorrelated, incomplete, non-Agent, or payload-free entries cannot satisfy the proof.
 * @returns Participant-visible text from the correlated completed reply.
 * @throws When no qualifying reply arrives before the five-minute deadline.
 */
export async function waitForTier3AgentAnswer(request, conversationId, initialPosition, messageId, sleep, now)
{
	let afterPosition = initialPosition;
	const deadline = now() + _ANSWER_TIMEOUT_MILLISECONDS;
	for (let attempt = 0; attempt < _ANSWER_POLL_LIMIT; attempt += 1)
	{
		const remainingMilliseconds = deadline - now();
		if (remainingMilliseconds <= 0)
			break;
		const page = (await request("GET", `/api/v1/me/conversations/${encodeURIComponent(conversationId)}/history?afterPosition=${encodeURIComponent(afterPosition)}`, undefined, new Set([200]), remainingMilliseconds)).body;
		for (const entry of page?.entries ?? [])
		{
			if (entry.kind !== "message" || entry.provenance !== "agent-authored" || entry.author?.kind !== "agent" || entry.state !== "completed" || entry.replyToEntryId !== messageId || entry.correlationId !== messageId || typeof entry.runId !== "string")
				continue;
			const text = (entry.blocks ?? []).filter(function _Text(block) { return block.kind === "text"; }).map(function _Payload(block) { return page.payloads?.[block.payloadRef]; }).filter(function _Present(value) { return typeof value === "string" && value.trim(); }).join("\n").trim();
			if (text)
				return text;
		}
		if (typeof page?.nextPosition === "string")
			afterPosition = page.nextPosition;
		await sleep(Math.min(_POLL_INTERVAL_MILLISECONDS, Math.max(0, deadline - now())));
	}
	throw new Error("Tier 3 agent did not produce a participant-visible response within five minutes.");
}
