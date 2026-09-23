import { randomUUID } from "node:crypto";

import { createTier3AgentRequest } from "./agent-journey-client.mjs";
import { completeTier3BootstrapChat, completeTier3Persona, readTier3PersonalAgent } from "./agent-journey-onboarding.mjs";
import { configureTier3Provider } from "./agent-journey-provider.mjs";
import { waitForTier3AgentAnswer } from "./agent-journey-response.mjs";

/**
 * Proves the current IAM, BYOK, onboarding, KurrentDB, and Agent Sandbox path with one real turn.
 * Success means history contains the completed agent-authored reply correlated to this command;
 * timeouts or an unrecognized intermediate product state fail the qualification.
 * @returns The created conversation and the length of its participant-visible answer.
 * @throws When credentials, product transitions, request deadlines, or response evidence fail.
 */
export async function runTier3AgentJourney(input, operations = {})
{
	const request = createTier3AgentRequest(input.origin, input.credential, operations.fetch ?? fetch, operations.requestTimeoutMilliseconds);
	const sleep = operations.sleep ?? _Sleep;
	const now = operations.now ?? Date.now;
	const uuid = operations.uuid ?? randomUUID;
	const write = operations.write ?? function _Write(message) { process.stdout.write(message); };
	write(`Tier 3 agent is configuring ${input.provider} through the current BYOK authority.\n`);
	await configureTier3Provider(request, input.provider, input.providerKey, sleep, now);
	await request("GET", "/api/v1/me/onboarding");
	await completeTier3Persona(request);
	await completeTier3BootstrapChat(request, uuid);
	const personalAgentRef = await readTier3PersonalAgent(request);
	const created = await request("POST", "/api/v1/me/conversations", { mode: "agent_session", personalAgentRef, idempotencyKey: uuid() });
	const conversationId = created.body?.conversation?.id;
	if (typeof conversationId !== "string" || !conversationId) throw new Error("Tier 3 agent journey did not create a personal conversation.");
	const messageId = uuid();
	const accepted = await request("POST", `/api/v1/me/conversations/${encodeURIComponent(conversationId)}/messages`, { idempotencyKey: messageId, text: "Reply with a brief confirmation that the OpenCrane Tier 3 agent is ready.", activation: "start" });
	if (typeof accepted.body?.position !== "string") throw new Error("Tier 3 agent message did not return its immutable history position.");
	const answer = await waitForTier3AgentAnswer(request, conversationId, accepted.body.position, messageId, sleep, now);
	write(`Tier 3 agent proved a provider-backed response through Agent Sandbox (${answer.length} characters).\n`);
	return { conversationId, responseLength: answer.length };
}

function _Sleep(milliseconds) { return new Promise(function _Wait(resolve) { setTimeout(resolve, milliseconds); }); }
