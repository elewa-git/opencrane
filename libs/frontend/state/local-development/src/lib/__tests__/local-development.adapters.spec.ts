import { describe, expect, it } from "vitest";

import { ConversationModes } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { ConversationAssetLifecycle } from "@opencrane/state/conversation/assets";

import { _CreateLocalDevelopmentOwner } from "../local-development.owner";

/** Creates a deterministic named owner whose onboarding state is already complete. */
function _Owner()
{
	return _CreateLocalDevelopmentOwner({ archetype: PersonaFirstChatArchetypes.Commander, startWithOnboarding: false });
}

describe("Tier 1 local-development adapters", function _DescribeAdapters()
{
	it("shares one workspace state and makes retry-stable commands idempotent", async function _RetryStableCommands()
	{
		const owner = _Owner();
		const createCommand = { mode: ConversationModes.Direct, participantRefs: ["local-peer"], idempotencyKey: "create-direct" } as const;
		const created = await owner.workspace.create(createCommand);
		expect(await owner.workspace.create(createCommand)).toEqual(created);
		expect((await owner.workspace.list()).filter(item => item.id === created.id)).toHaveLength(1);

		const sendCommand = { conversationId: created.id, idempotencyKey: "message-once", text: "Accepted exactly once", activation: "none" } as const;
		await owner.workspace.send(sendCommand);
		await owner.workspace.send(sendCommand);
		const history = await owner.stream.stream({ conversationId: created.id, signal: new AbortController().signal });
		expect(history.entries.filter(entry => entry.idempotencyKey === sendCommand.idempotencyKey)).toHaveLength(1);
	});

	it("keeps file bytes disposable while preserving reservation retries", async function _FileLifecycle()
	{
		const owner = _Owner();
		const request = { idempotencyKey: "asset-once", displayName: "notes.txt", mediaType: "text/plain", byteLength: 5, contentAddress: "sha256:hello" };
		const reserved = await owner.assets.reserve("conversation-agent", request);
		expect(await owner.assets.reserve("conversation-agent", request)).toEqual(reserved);
		expect(await owner.assets.list("conversation-agent")).toHaveLength(1);

		const file = new File(["hello"], "notes.txt", { type: "text/plain" });
		expect((await owner.assets.upload("conversation-agent", reserved.id, file)).state).toBe(ConversationAssetLifecycle.Ready);
		expect(await owner.assets.read("conversation-agent", reserved.id)).toBe(file);
		expect((await owner.assets.remove("conversation-agent", reserved.id)).state).toBe(ConversationAssetLifecycle.Removed);
		await expect(owner.assets.read("conversation-agent", reserved.id)).rejects.toThrow("unavailable");
	});

	it("deduplicates group-child retries and denies every Tier 3 computer surface", async function _TierBoundaries()
	{
		const owner = _Owner();
		await owner.workspace.send({ conversationId: "local-conversation-group", idempotencyKey: "parent-message", text: "Ask the company assistant", activation: "none" });
		const childCommand = { parentMessageId: "parent-message", parentMessagePosition: "2", agentServiceId: "local-company-agent", idempotencyKey: "child-once" };
		const child = await owner.groupChildren.createChild("local-conversation-group", childCommand);
		expect(await owner.groupChildren.createChild("local-conversation-group", childCommand)).toEqual(child);
		expect(await owner.groupChildren.listChildren("local-conversation-group")).toHaveLength(1);
		expect(await owner.workspace.open(child.conversationId)).toMatchObject({ parent: { parentConversationId: "local-conversation-group", parentMessageId: "parent-message", parentMessagePosition: "2" } });
		const childHistory = await owner.stream.stream({ conversationId: child.conversationId, signal: new AbortController().signal });
		const source = childHistory.entries[0]!;
		const share = { sourceEntryId: source.id, sourcePosition: source.position, text: "Reviewed local result", idempotencyKey: "share-once" };
		await owner.groupChildren.shareChild(child.conversationId, share);
		await owner.groupChildren.shareChild(child.conversationId, share);
		const parentHistory = await owner.stream.stream({ conversationId: "local-conversation-group", signal: new AbortController().signal });
		expect(parentHistory.entries.filter(entry => entry.idempotencyKey === share.idempotencyKey)).toHaveLength(1);
		expect(Object.values(parentHistory.payloads)).toContain(share.text);

		await expect(owner.computerReview.readComputerFile("conversation-agent", "README.md")).rejects.toThrow("Tier 3");
		await expect(owner.computerReview.readComputerDiff("conversation-agent", ".")).rejects.toThrow("Tier 3");
		await expect(owner.computerReview.runComputerCommand("conversation-agent", ["git", "status"], ".")).rejects.toThrow("Tier 3");
		await expect(owner.computerReview.listComputerBrowserTargets("conversation-agent")).rejects.toThrow("Tier 3");
		await expect(owner.computerReview.openComputerBrowserPage("conversation-agent", 4200, "/")).rejects.toThrow("Tier 3");
		await expect(owner.computerReview.captureComputerScreenshot("conversation-agent", 4200, "/", 1280, 720)).rejects.toThrow("Tier 3");
		await expect(owner.computerReview.readComputerPreview("conversation-agent", 4200, "/")).rejects.toThrow("Tier 3");
	});
});
