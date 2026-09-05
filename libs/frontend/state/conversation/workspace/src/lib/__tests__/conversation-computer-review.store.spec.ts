import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_COMPUTER_REVIEW_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationComputerReviewStore } from "../conversation-computer-review.store";
import type { ConversationComputerReviewGateway } from "../conversation-workspace.types";

/** Build the narrow computer-review gateway test double. */
function _Gateway(): ConversationComputerReviewGateway
{
	return { readComputerFile: vi.fn().mockResolvedValue("source"), readComputerDiff: vi.fn().mockResolvedValue({ exitCode: 0, outcome: "completed", output: "diff", truncated: false }), runComputerCommand: vi.fn().mockResolvedValue({ exitCode: 0, outcome: "completed", output: "ok", truncated: false }), listComputerBrowserTargets: vi.fn().mockResolvedValue([{ id: "page-1", title: "Preview", url: "http://127.0.0.1:5173/" }]), openComputerBrowserPage: vi.fn().mockResolvedValue(undefined), captureComputerScreenshot: vi.fn().mockResolvedValue(new Blob(["png"])), readComputerPreview: vi.fn().mockResolvedValue("preview") };
}

/** Construct a component-scoped review store. */
function _Store(gateway: ConversationComputerReviewGateway): ConversationComputerReviewStore
{
	const injector = Injector.create({ providers: [ConversationComputerReviewStore, { provide: CONVERSATION_COMPUTER_REVIEW_GATEWAY, useValue: gateway }] });
	return runInInjectionContext(injector, function _Create() { return injector.get(ConversationComputerReviewStore); });
}

describe("ConversationComputerReviewStore", function _DescribeStore()
{
	it("loads files and diffs through the authenticated review port", async function _Inspects()
	{
		const gateway = _Gateway();
		const store = _Store(gateway);
		store.select("conversation-1");
		await store.inspect("src/main.ts");
		expect(gateway.readComputerFile).toHaveBeenCalledWith("conversation-1", "src/main.ts");
		expect(store.file()).toBe("source");
		expect(store.diff()?.output).toBe("diff");
	});

	it("purges computer output when the selected conversation changes", async function _Purges()
	{
		const store = _Store(_Gateway());
		store.select("conversation-1");
		await store.run(["git", "status"]);
		store.select(null);
		expect(store.command()).toBeNull();
		expect(store.file()).toBe("");
	});

	it("purges results when the same conversation receives a new computer generation", async function _PurgesReplacement()
	{
		const store = _Store(_Gateway());
		store.select("conversation-1", "computer-1:1");
		await store.run(["git", "status"]);
		store.select("conversation-1", "computer-1:2");
		expect(store.command()).toBeNull();
	});
});
