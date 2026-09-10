import { describe, expect, it } from "vitest";

import { ConversationModes } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes, UserOnboardingRouteStates } from "@opencrane/models/user-onboarding";
import { ConversationWorkspaceGatewayErrorKinds } from "@opencrane/state/conversation/workspace";

import { _CreateLocalDevelopmentOwner } from "../local-development.owner";
import { _LOCAL_DEVELOPMENT_NAMED_SELECTIONS } from "../local-development.persona-fixtures";

/** Advances a plain owner through the reviewed named persona path. */
async function _ReadyOwner()
{
	const owner = _CreateLocalDevelopmentOwner({ startWithOnboarding: true });
	await owner.persona.startInterview();
	let persona = await owner.persona.load();
	const selections = _LOCAL_DEVELOPMENT_NAMED_SELECTIONS[PersonaFirstChatArchetypes.Commander];
	for (const [index, question] of persona.questions.entries())
	{
		await owner.persona.recordAnswer(persona.interviewId!, question.id, selections[index]!);
	}
	persona = await owner.persona.load();
	await owner.persona.completeInterview(persona.interviewId!);
	await owner.persona.createDraft(persona.interviewId!);
	persona = await owner.persona.load();
	await owner.persona.approve(persona.personaRevisionId!);
	return owner;
}

/** Creates a named owner whose ordinary workspace is immediately available. */
function _WorkspaceOwner()
{
	return _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Commander, startWithOnboarding: false });
}

describe("Tier 1 local-development command contracts", function _DescribeContracts()
{
	it("returns the current chat when an old accepted answer is replayed", async function _CurrentFirstChatReplay()
	{
		const owner = await _ReadyOwner();
		let chat = await owner.firstChat.start();
		const first = { expectedConversationId: chat.conversationId!, expectedQuestionOrdinal: 1, text: "First accepted answer", idempotencyKey: "first-answer" };
		chat = await owner.firstChat.answer(first);
		chat = await owner.firstChat.answer({ expectedConversationId: chat.conversationId!, expectedQuestionOrdinal: 2, text: "Second accepted answer", idempotencyKey: "second-answer" });
		chat = await owner.firstChat.answer({ expectedConversationId: chat.conversationId!, expectedQuestionOrdinal: 3, text: "Third accepted answer", idempotencyKey: "third-answer" });
		await owner.firstChat.conclude();

		const replayed = await owner.firstChat.answer(first);
		expect(replayed).toMatchObject({ state: UserOnboardingRouteStates.Completed, answerCount: 3, canConclude: false });
	});

	it("binds creation and message retry keys to their exact accepted commands", async function _WorkspaceReceipts()
	{
		const owner = _WorkspaceOwner();
		const create = { mode: ConversationModes.Direct, participantRefs: ["local-peer"], idempotencyKey: "create-receipt" } as const;
		const created = await owner.workspace.create(create);
		expect(await owner.workspace.create(create)).toEqual(created);
		await expect(owner.workspace.create({ ...create, participantRefs: ["local-peer-two"] })).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Conflict });

		const message = { conversationId: "local-conversation-direct", idempotencyKey: "message-receipt", text: "Accepted text", activation: "none" } as const;
		await owner.workspace.send(message);
		await owner.workspace.send(message);
		await expect(owner.workspace.send({ ...message, text: "Changed text" })).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Conflict });
		await expect(owner.workspace.send({ ...message, conversationId: "unknown-conversation", idempotencyKey: "unknown-message" })).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });

		await owner.workspace.send({ ...message, conversationId: "local-conversation-group" });
		const direct = await owner.stream.stream({ conversationId: "local-conversation-direct", signal: new AbortController().signal });
		const group = await owner.stream.stream({ conversationId: "local-conversation-group", signal: new AbortController().signal });
		expect(direct.entries.filter(entry => entry.idempotencyKey === message.idempotencyKey)).toHaveLength(1);
		expect(group.entries.filter(entry => entry.idempotencyKey === message.idempotencyKey)).toHaveLength(1);
	});

	it("scopes file retries and bytes to the selected conversation", async function _AssetReceipts()
	{
		const owner = _WorkspaceOwner();
		const request = { idempotencyKey: "asset-receipt", displayName: "notes.txt", mediaType: "text/plain", byteLength: 5, contentAddress: "sha256:hello" };
		await expect(owner.assets.reserve("unknown-conversation", request)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });
		const reserved = await owner.assets.reserve("local-conversation-direct", request);
		expect(await owner.assets.reserve("local-conversation-direct", request)).toEqual(reserved);
		await expect(owner.assets.reserve("local-conversation-direct", { ...request, contentAddress: "sha256:changed" })).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Conflict });

		const file = new File(["hello"], "notes.txt", { type: "text/plain" });
		await owner.assets.upload("local-conversation-direct", reserved.id, file);
		expect(await owner.assets.read("local-conversation-direct", reserved.id)).toBe(file);
		await expect(owner.assets.read("local-conversation-group", reserved.id)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Unavailable });
		expect((await owner.assets.reserve("local-conversation-group", request)).conversationId).toBe("local-conversation-group");
	});

	it("binds child and reviewed-share keys to their exact coordinates", async function _GroupReceipts()
	{
		const owner = _WorkspaceOwner();
		await owner.workspace.send({ conversationId: "local-conversation-group", idempotencyKey: "parent-message", text: "Create a reviewed child", activation: "none" });
		const childCommand = { parentMessageId: "parent-message", parentMessagePosition: "2", agentServiceId: "local-company-agent", idempotencyKey: "child-receipt" };
		await expect(owner.groupChildren.createChild("unknown-conversation", childCommand, new AbortController().signal)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });
		const child = await owner.groupChildren.createChild("local-conversation-group", childCommand, new AbortController().signal);
		expect(await owner.groupChildren.createChild("local-conversation-group", childCommand, new AbortController().signal)).toEqual(child);
		await expect(owner.groupChildren.createChild("local-conversation-group", { ...childCommand, agentServiceId: "another-agent" }, new AbortController().signal)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Conflict });

		const childDetail = await owner.workspace.open(child.conversationId);
		expect(childDetail).toMatchObject({ participantRefs: ["local-developer", "local-peer", "local-peer-two"], parent: { requestId: "local-child-request-child-receipt", parentConversationId: "local-conversation-group", parentMessageId: "parent-message", parentMessagePosition: "2" } });
		const secondChild = await owner.groupChildren.createChild("local-conversation-group", { ...childCommand, idempotencyKey: "child-receipt-two" }, new AbortController().signal);
		const secondDetail = await owner.workspace.open(secondChild.conversationId);
		expect(secondDetail.parent?.requestId).not.toBe(childDetail.parent?.requestId);
		const childHistory = await owner.stream.stream({ conversationId: child.conversationId, signal: new AbortController().signal });
		const source = childHistory.entries[0]!;
		const share = { sourceEntryId: source.id, sourcePosition: source.position, text: "Reviewed result", idempotencyKey: "share-receipt" };
		await owner.groupChildren.shareChild(child.conversationId, share, new AbortController().signal);
		await expect(owner.groupChildren.shareChild(child.conversationId, share, new AbortController().signal)).resolves.toBeUndefined();
		await expect(owner.groupChildren.shareChild(child.conversationId, { ...share, text: "Changed review" }, new AbortController().signal)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Conflict });
		await expect(owner.groupChildren.shareChild(child.conversationId, { ...share, sourcePosition: "9", idempotencyKey: "stale-source" }, new AbortController().signal)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.Conflict });
		const parentHistory = await owner.stream.stream({ conversationId: "local-conversation-group", signal: new AbortController().signal });
		const sharedEntries = parentHistory.entries.filter(entry => entry.idempotencyKey === share.idempotencyKey);
		expect(sharedEntries).toHaveLength(1);
		expect(sharedEntries[0]).toMatchObject({ causationId: source.id, correlationId: childDetail.parent?.requestId, replyToEntryId: "parent-message" });
		expect(Object.values(parentHistory.payloads)).toContain(share.text);
		await expect(owner.groupChildren.shareChild("unknown-child", { ...share, idempotencyKey: "unknown-share" }, new AbortController().signal)).rejects.toMatchObject({ kind: ConversationWorkspaceGatewayErrorKinds.AccessChanged });
	});
});
