import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { _GovernanceStoreFixture } from "./governance-store.fixture";

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset() { TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

describe("governance reader scope", function _Scope()
{
	it("creates a different scope when the same reader returns after another reader", function _ReturningReader()
	{
		const fixture = _GovernanceStoreFixture();
		const firstA = fixture.context.scope();
		fixture.reader.set("reader-b");
		expect(fixture.context.scope().identity).toBe("reader-b");
		fixture.reader.set("reader-a");
		expect(fixture.context.scope().identity).toBe("reader-a");
		expect(fixture.context.scope()).not.toBe(firstA);
	});

	it("does not let an old failed request close an explicitly rechecked session", function _OldFailure()
	{
		const fixture = _GovernanceStoreFixture();
		const original = fixture.context.scope();
		fixture.context.loseAuthentication(original);
		expect(fixture.context.scope().identity).toBeNull();
		fixture.context.recheck();
		const rechecked = fixture.context.scope();
		expect(rechecked.identity).toBe("reader-a");
		expect(rechecked).not.toBe(original);
		fixture.context.loseAuthentication(original);
		expect(fixture.context.scope()).toBe(rechecked);
	});

	it("cannot create authenticated identity when the app supplies none", function _NoIdentity()
	{
		const fixture = _GovernanceStoreFixture(null);
		fixture.context.recheck();
		expect(fixture.context.scope().identity).toBeNull();
	});
});
