import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationPdfPickerComponent } from "../pdf-picker/conversation-pdf-picker.component";

/** Calls the protected DOM handler through the component's actual event boundary. */
function _Select(component: ConversationPdfPickerComponent, files: readonly File[]): void
{
	const inputElement = document.createElement("input");
	Object.defineProperty(inputElement, "files", { value: files });
	const handler = component as unknown as { readonly selectFiles: (event: Event) => void };
	handler.selectFiles({ target: inputElement } as unknown as Event);
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationPdfPickerComponent", function _Suite()
{
	it("emits PDF files without reading their bytes", function _EmitsPdf()
	{
		const component = TestBed.runInInjectionContext(function _Component() { return new ConversationPdfPickerComponent(); });
		const emitted = vi.fn();
		component.filesSelected.subscribe(emitted);
		const file = new File(["private bytes"], "brief.pdf", { type: "application/pdf" });
		const read = vi.fn();
		Object.defineProperty(file, "arrayBuffer", { value: read });

		_Select(component, [file]);

		expect(emitted).toHaveBeenCalledWith([file]);
		expect(read).not.toHaveBeenCalled();
		expect(component.error()).toBeNull();
	});

	it("rejects a mixed batch without emitting a partial selection", function _RejectsMixedBatch()
	{
		const component = TestBed.runInInjectionContext(function _Component() { return new ConversationPdfPickerComponent(); });
		const emitted = vi.fn();
		component.filesSelected.subscribe(emitted);

		_Select(component, [new File(["pdf"], "brief.pdf", { type: "application/pdf" }), new File(["data"], "data.csv", { type: "text/csv" })]);

		expect(emitted).not.toHaveBeenCalled();
		expect(component.error()).toBe("Choose PDF files only.");
	});
});
