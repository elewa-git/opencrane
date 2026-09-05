import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationComputerReviewComponent } from "../conversation-computer-review.component";

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	const template = readFileSync(join(process.cwd(), "src/lib/components/conversation-computer-review/conversation-computer-review.component.html"), "utf8");
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("conversation-computer-review.component.html"))
			return template;
		return "";
	});
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationComputerReviewComponent", function _DescribeReview()
{
	it("emits argv intent without interpreting shell syntax", async function _EmitsCommand()
	{
		TestBed.configureTestingModule({ imports: [ConversationComputerReviewComponent] });
		const fixture = TestBed.createComponent(ConversationComputerReviewComponent);
		const emitted = vi.fn();
		fixture.componentInstance.commandRequested.subscribe(emitted);
		fixture.detectChanges();
		const input = fixture.nativeElement.querySelector('[aria-label="Allowlisted command"]') as HTMLInputElement;
		input.value = "git status";
		const buttons = [...fixture.nativeElement.querySelectorAll("button")] as HTMLButtonElement[];
		buttons.find(button => button.textContent?.includes("Run"))?.click();
		expect(emitted).toHaveBeenCalledWith(["git", "status"]);
	});

});
