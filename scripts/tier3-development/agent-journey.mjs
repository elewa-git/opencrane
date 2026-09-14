import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

const _SESSION_HEADER = "x-opencrane-development-session";
const _PROVIDER_RETRY_LIMIT = 30;
const _ANSWER_POLL_LIMIT = 150;
const _POLL_INTERVAL_MILLISECONDS = 2_000;

/** Prove current IAM, BYOK, onboarding, KurrentDB, and Agent Sandbox with one real assistant turn. */
export async function runTier3AgentJourney(input, operations = {})
{
	const providerKey = await (operations.readProviderKey ?? readTier3ProviderKey)(input.options.providerKeyFile);
	const request = _Client(input.origin, input.credential, operations.fetch ?? fetch);
	const sleep = operations.sleep ?? _Sleep;
	const uuid = operations.uuid ?? randomUUID;
	const write = operations.write ?? function _Write(message) { process.stdout.write(message); };
	write(`Tier 3 agent is configuring ${input.options.provider} through the current BYOK authority.\n`);
	await _ConfigureProvider(request, input.options.provider, providerKey, sleep);
	await request("GET", "/api/v1/me/onboarding");
	await _CompletePersona(request);
	await _CompleteBootstrapChat(request, uuid);
	const personalAgentRef = await _ReadPersonalAgent(request);
	const created = await request("POST", "/api/v1/me/conversations", { mode: "agent_session", personalAgentRef, idempotencyKey: uuid() });
	const conversationId = created.body?.conversation?.id;
	if (typeof conversationId !== "string" || !conversationId) throw new Error("Tier 3 agent journey did not create a personal conversation.");
	const messageId = uuid();
	const accepted = await request("POST", `/api/v1/me/conversations/${encodeURIComponent(conversationId)}/messages`, { idempotencyKey: messageId, text: "Reply with a brief confirmation that the OpenCrane Tier 3 agent is ready.", activation: "start" });
	if (typeof accepted.body?.position !== "string") throw new Error("Tier 3 agent message did not return its immutable history position.");
	const answer = await _WaitForAgentAnswer(request, conversationId, accepted.body.position, messageId, sleep);
	write(`Tier 3 agent proved a provider-backed response through Agent Sandbox (${answer.length} characters).\n`);
	return { conversationId, responseLength: answer.length };
}

/** Read one owner-only provider key without following a symbolic link. */
export async function readTier3ProviderKey(path)
{
	if (!isAbsolute(path)) throw new Error("Tier 3 provider key file must use an absolute path.");
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Tier 3 provider key must be an ordinary file, not a link.");
	if ((metadata.mode & 0o077) !== 0) throw new Error("Tier 3 provider key file must be owner-only; run chmod 600 on it.");
	const key = (await readFile(path, "utf8")).trim();
	if (!key) throw new Error("Tier 3 provider key file is empty.");
	return key;
}

async function _ConfigureProvider(request, provider, apiKey, sleep)
{
	let commandId;
	for (let attempt = 0; attempt < _PROVIDER_RETRY_LIMIT; attempt += 1)
	{
		const body = commandId === undefined ? { apiKey } : { apiKey, commandId };
		const result = await request("PUT", `/api/v1/providers/byok/${encodeURIComponent(provider)}`, body, new Set([200, 503]));
		if (result.status === 200)
		{
			if (result.body?.provider !== provider || result.body?.configured !== true || result.body?.litellmRegistered !== true) throw new Error("Tier 3 BYOK response did not prove a usable provider connection.");
			return;
		}
		if (result.body?.code !== "PROVIDER_EFFECT_PENDING" || typeof result.body?.commandId !== "string") throw new Error("Tier 3 BYOK delivery returned an unresumable pending response.");
		commandId = result.body.commandId;
		await sleep(_POLL_INTERVAL_MILLISECONDS);
	}
	throw new Error("Tier 3 BYOK delivery did not settle within one minute.");
}

async function _CompletePersona(request)
{
	for (let transition = 0; transition < 16; transition += 1)
	{
		const status = (await request("GET", "/api/v1/me/persona")).body;
		if (status?.state === "ready") return;
		if (status?.state === "interview")
		{
			if (typeof status.interviewId !== "string") await request("POST", "/api/v1/me/persona/interview", {});
			else
			{
				for (const question of status.questions ?? [])
				{
					if (question.selectedChoiceId !== null) continue;
					const choiceId = question.choices?.[0]?.id;
					if (typeof question.id !== "string" || typeof choiceId !== "string") throw new Error("Tier 3 persona question has no reviewed choice.");
					await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/answers/${encodeURIComponent(question.id)}`, { choiceId });
				}
				await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/complete`, {});
			}
		}
		else if (status?.state === "resolution")
		{
			const selectedValue = status.resolution?.candidates?.[0];
			if (typeof status.interviewId !== "string" || typeof status.resolution?.kind !== "string" || typeof selectedValue !== "string") throw new Error("Tier 3 persona tie has no reviewed resolution candidate.");
			await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/resolutions/${encodeURIComponent(status.resolution.kind)}`, { selectedValue });
		}
		else if (status?.state === "review")
		{
			if (typeof status.interviewId !== "string") throw new Error("Tier 3 persona review has no interview evidence.");
			if (typeof status.personaRevisionId === "string") await request("POST", `/api/v1/me/persona/drafts/${encodeURIComponent(status.personaRevisionId)}/approve`, {});
			else await request("POST", `/api/v1/me/persona/interviews/${encodeURIComponent(status.interviewId)}/draft`, {});
		}
		else throw new Error(`Tier 3 persona returned unsupported state ${String(status?.state)}.`);
	}
	throw new Error("Tier 3 persona journey exceeded its bounded transition count.");
}

async function _CompleteBootstrapChat(request, uuid)
{
	let chat = (await request("GET", "/api/v1/me/onboarding/chat")).body;
	if (chat?.state === "bootstrap_chat_pending") chat = (await request("POST", "/api/v1/me/onboarding/chat/start", {})).body;
	for (let answer = 0; answer < 3 && chat?.currentQuestion !== null; answer += 1)
	{
		if (typeof chat?.conversationId !== "string" || !Number.isSafeInteger(chat.currentQuestion?.ordinal)) throw new Error("Tier 3 onboarding chat did not expose its current server-selected question.");
		chat = (await request("POST", "/api/v1/me/onboarding/chat/answers", { expectedConversationId: chat.conversationId, expectedQuestionOrdinal: chat.currentQuestion.ordinal, text: "Use concise, evidence-backed answers and ask before taking irreversible actions.", idempotencyKey: uuid() })).body;
	}
	if (chat?.canConclude !== true) throw new Error("Tier 3 onboarding chat did not become concludable after its reviewed questions.");
	const completed = (await request("POST", "/api/v1/me/onboarding/chat/conclude", {})).body;
	if (completed?.state !== "completed") throw new Error("Tier 3 onboarding completion was not admitted.");
}

async function _ReadPersonalAgent(request)
{
	const directory = (await request("GET", "/api/v1/me/conversations/directory")).body?.directory;
	const personalAgentRef = directory?.personalAgent?.personalAgentRef;
	if (directory?.personalAgentStatus !== "ready" || typeof personalAgentRef !== "string" || !personalAgentRef) throw new Error("Tier 3 personal agent is not ready after onboarding.");
	return personalAgentRef;
}

async function _WaitForAgentAnswer(request, conversationId, initialPosition, messageId, sleep)
{
	let afterPosition = initialPosition;
	for (let attempt = 0; attempt < _ANSWER_POLL_LIMIT; attempt += 1)
	{
		const page = (await request("GET", `/api/v1/me/conversations/${encodeURIComponent(conversationId)}/history?afterPosition=${encodeURIComponent(afterPosition)}`)).body;
		for (const entry of page?.entries ?? [])
		{
			if (entry.kind !== "message" || entry.provenance !== "agent-authored" || entry.author?.kind !== "agent" || entry.state !== "completed" || entry.replyToEntryId !== messageId || entry.correlationId !== messageId || typeof entry.runId !== "string") continue;
			const text = (entry.blocks ?? []).filter(function _Text(block) { return block.kind === "text"; }).map(function _Payload(block) { return page.payloads?.[block.payloadRef]; }).filter(function _Present(value) { return typeof value === "string" && value.trim(); }).join("\n").trim();
			if (text) return text;
		}
		if (typeof page?.nextPosition === "string") afterPosition = page.nextPosition;
		await sleep(_POLL_INTERVAL_MILLISECONDS);
	}
	throw new Error("Tier 3 agent did not produce a participant-visible response within five minutes.");
}

function _Client(origin, credential, fetchImplementation)
{
	return async function _Request(method, path, body, acceptedStatuses = new Set([200, 201, 202]))
	{
		const headers = { [_SESSION_HEADER]: credential };
		const options = { method, headers };
		if (body !== undefined)
		{
			headers["content-type"] = "application/json";
			headers.origin = origin;
			options.body = JSON.stringify(body);
		}
		const response = await fetchImplementation(new URL(path, origin), options);
		const text = await response.text();
		let parsed = null;
		if (text)
		{
			try { parsed = JSON.parse(text); }
			catch { throw new Error(`Tier 3 request ${method} ${path} returned non-JSON content.`); }
		}
		if (!acceptedStatuses.has(response.status)) throw new Error(`Tier 3 request ${method} ${path} failed with HTTP ${response.status}${typeof parsed?.code === "string" ? ` (${parsed.code})` : ""}.`);
		return { status: response.status, body: parsed };
	};
}

function _Sleep(milliseconds) { return new Promise(function _Wait(resolve) { setTimeout(resolve, milliseconds); }); }
