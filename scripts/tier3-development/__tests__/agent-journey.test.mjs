import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runTier3AgentJourney } from "../agent-journey.mjs";
import { readTier3ProviderKey } from "../provider-credentials.mjs";

test("provider key reader accepts only an owner-only ordinary absolute file", async function _ProviderKeyFile()
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-tier3-key-"));
	const path = join(directory, "provider-key");
	try
	{
		await writeFile(path, "provider-secret\n", { mode: 0o600 });
		assert.equal(await readTier3ProviderKey(path), "provider-secret");
		await chmod(path, 0o644);
		await assert.rejects(readTier3ProviderKey(path), /owner-only/);
		await assert.rejects(readTier3ProviderKey("provider-key"), /absolute path/);
	}
	finally { await rm(directory, { recursive: true, force: true }); }
});

test("agent journey resumes current authorities and proves an agent-authored private payload", async function _FullJourney()
{
	const calls = [];
	let personaRead = 0;
	let chatAnswer = 0;
	let providerAttempt = 0;
	let historyRead = 0;
	const responses = {
		"GET /api/v1/me/onboarding": { state: "survey_pending" },
		"POST /api/v1/me/persona/interview": { interviewId: "interview-1" },
		"POST /api/v1/me/persona/interviews/interview-1/answers/q1": { answerId: "answer-1" },
		"POST /api/v1/me/persona/interviews/interview-1/complete": { state: "completed" },
		"POST /api/v1/me/persona/interviews/interview-1/draft": { personaRevisionId: "revision-1" },
		"POST /api/v1/me/persona/drafts/revision-1/approve": { state: "approved" },
		"POST /api/v1/me/onboarding/chat/start": { state: "bootstrap_chat_in_progress", conversationId: "onboarding-1", currentQuestion: { ordinal: 1 }, canConclude: false },
		"POST /api/v1/me/onboarding/chat/conclude": { state: "completed" },
		"GET /api/v1/me/conversations/directory": { directory: { personalAgentStatus: "ready", personalAgent: { personalAgentRef: "agent-1" } } },
		"POST /api/v1/me/conversations": { conversation: { id: "conversation-1" } },
		"POST /api/v1/me/conversations/conversation-1/messages": { outcome: "accepted", position: "1" },
	};
	async function _Fetch(url, options)
	{
		const parsed = new URL(url);
		const key = `${options.method} ${parsed.pathname}${options.method === "GET" && parsed.search ? parsed.search : ""}`;
		calls.push({ key, headers: options.headers, body: options.body });
		if (key === "PUT /api/v1/providers/byok/openai")
		{
			providerAttempt += 1;
			return _Response(providerAttempt === 1 ? 503 : 200, providerAttempt === 1 ? { code: "PROVIDER_EFFECT_PENDING", commandId: "command-1" } : { provider: "openai", configured: true, litellmRegistered: true });
		}
		if (key === "GET /api/v1/me/persona")
		{
			personaRead += 1;
			return _Response(200, [
				{ state: "interview", interviewId: null },
				{ state: "interview", interviewId: "interview-1", questions: [{ id: "q1", selectedChoiceId: null, choices: [{ id: "choice-1" }] }] },
				{ state: "review", interviewId: "interview-1", personaRevisionId: null },
				{ state: "review", interviewId: "interview-1", personaRevisionId: "revision-1" },
				{ state: "ready" },
			][personaRead - 1]);
		}
		if (key === "GET /api/v1/me/onboarding/chat") return _Response(200, { state: "bootstrap_chat_pending" });
		if (key === "POST /api/v1/me/onboarding/chat/answers")
		{
			chatAnswer += 1;
			return _Response(201, { state: "bootstrap_chat_in_progress", conversationId: "onboarding-1", currentQuestion: chatAnswer < 3 ? { ordinal: chatAnswer + 1 } : null, canConclude: chatAnswer === 3 });
		}
		if (key === "GET /api/v1/me/conversations/conversation-1/history?afterPosition=1")
		{
			historyRead += 1;
			return _Response(200, historyRead === 1 ? { entries: [], payloads: {}, nextPosition: "1" } : { entries: [{ kind: "message", provenance: "agent-authored", author: { kind: "agent" }, state: "completed", replyToEntryId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", correlationId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", runId: "run-1", blocks: [{ kind: "text", payloadRef: "answer" }] }], payloads: { answer: "Tier 3 is ready." }, nextPosition: "2" });
		}
		return _Response(key.includes("/answers/") ? 201 : 200, responses[key]);
	}
	const output = [];
	const result = await runTier3AgentJourney({ credential: "session-proof", origin: "http://127.0.0.1:4200", provider: "openai", providerKey: "provider-secret" }, { fetch: _Fetch, sleep: async function _NoWait() {}, uuid: function _Uuid() { return "31c1f1dc-0010-4f13-9c2f-d3841ffd6651"; }, write: function _Write(message) { output.push(message); } });

	assert.deepEqual(result, { conversationId: "conversation-1", responseLength: 16 });
	assert.equal(chatAnswer, 3);
	assert.equal(providerAttempt, 2);
	assert.equal(JSON.parse(calls.find(function _Provider(call) { return call.key.startsWith("PUT "); }).body).apiKey, "provider-secret");
	assert.equal(JSON.parse(calls.filter(function _Provider(call) { return call.key.startsWith("PUT "); })[1].body).commandId, "command-1");
	assert.ok(calls.every(function _Credential(call) { return call.headers["x-opencrane-development-session"] === "session-proof"; }));
	assert.ok(calls.filter(function _Mutation(call) { return !call.key.startsWith("GET "); }).every(function _Origin(call) { return call.headers.origin === "http://127.0.0.1:4200"; }));
	assert.match(output.join(""), /provider-backed response/);
	assert.doesNotMatch(output.join(""), /provider-secret|session-proof/);
});

test("agent journey aborts a stalled request within its configured bound", async function _RequestTimeout()
{
	await assert.rejects(runTier3AgentJourney({ credential: "session-proof", origin: "http://127.0.0.1:4200", provider: "openai", providerKey: "provider-secret" }, {
		fetch: async function _Stalled(_url, options) { return new Promise(function _Wait(_resolve, reject) { options.signal.addEventListener("abort", function _Abort() { const error = new Error("aborted"); error.name = "AbortError"; reject(error); }, { once: true }); }); },
		requestTimeoutMilliseconds: 5,
		write: function _Write() {},
	}), /timed out after 5 ms/u);
});

test("agent journey aborts a stalled response body within its configured bound", async function _ResponseTimeout()
{
	await assert.rejects(runTier3AgentJourney({ credential: "session-proof", origin: "http://127.0.0.1:4200", provider: "openai", providerKey: "provider-secret" }, {
		fetch: async function _Response(_url, options) { return { status: 200, text: async function _StalledBody() { return new Promise(function _Wait(_resolve, reject) { options.signal.addEventListener("abort", function _Abort() { reject(new Error("aborted")); }, { once: true }); }); } }; },
		requestTimeoutMilliseconds: 5,
		write: function _Write() {},
	}), /timed out after 5 ms/u);
});

function _Response(status, body)
{
	return { status, text: async function _Text() { return body === undefined ? "" : JSON.stringify(body); } };
}
