import { describe, expect, it, vi } from "vitest";

import { ConversationAssetActionKinds } from "@opencrane/features/conversation-assets";

import { ConversationWorkspacePresenter } from "../conversation-workspace.presenter";

describe("ConversationWorkspacePresenter", function _Suite()
{
	it("rejects file additions and deselection while the visible ambiguous retry set is locked", async function _LockedSelection()
	{
		const select = vi.fn();
		const deselectMessageAsset = vi.fn();
		const context = { attachmentSelectionLocked: function _Locked() { return true; }, assetsStore: { select, deselectMessageAsset } };
		const file = { name: "new.pdf" } as File;

		await ConversationWorkspacePresenter.prototype.selectFiles.call(context as never, [file]);
		await ConversationWorkspacePresenter.prototype.assetAction.call(context as never, { kind: ConversationAssetActionKinds.Deselect, assetId: "asset-a" });

		expect(select).not.toHaveBeenCalled();
		expect(deselectMessageAsset).not.toHaveBeenCalled();
	});
});
