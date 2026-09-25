import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationAttachmentChipComponent } from "../attachment-chip/conversation-attachment-chip.component";
import { ConversationAssetActionKinds, ConversationAssetPresentationStates } from "../conversation-asset-presentation.types";

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationAttachmentChipComponent", function _Suite()
{
	it("emits a distinct message deselection instead of a server removal", function _Deselect()
	{
		const component = TestBed.runInInjectionContext(function _Component() { return new ConversationAttachmentChipComponent(); });
		Object.defineProperty(component, "item", { value: function _Item() { return { id: "asset-1", messageId: null, artifactId: null, artifactRevisionId: null, provenance: "participant_upload", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, disposition: "preview", state: ConversationAssetPresentationStates.Ready, detail: "Ready", canRetry: false, canRemove: false, uploadProgressPercent: null, contentState: "idle", contentDetail: null }; } });
		const emitted = vi.fn();
		component.actionRequested.subscribe(emitted);

		component.deselect();

		expect(emitted).toHaveBeenCalledExactlyOnceWith({ kind: ConversationAssetActionKinds.Deselect, assetId: "asset-1" });
	});
});
