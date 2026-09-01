// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PLATFORM_SURFACE } from "../platform-surface";
import { SESSION_GATEWAY, type SessionGateway } from "../session-gateway.types";
import { SessionStore } from "../session-store";

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { vi.unstubAllGlobals(); TestBed.resetTestingModule(); });

describe("SessionStore gateway boundary", function _Suite()
{
	it("loads and logs out through the injected gateway for the exact application surface", async function _UsesGateway()
	{
		const gateway: SessionGateway = {
			load: vi.fn().mockResolvedValue({ authenticated: true, user: { sub: "user-1", name: "Ada", groups: [], isPlatformOperator: false, productCapabilities: { administerOrganization: false } } }),
			logout: vi.fn().mockResolvedValue(undefined)
		};
		TestBed.configureTestingModule({ providers: [SessionStore, { provide: SESSION_GATEWAY, useValue: gateway }, { provide: PLATFORM_SURFACE, useValue: "org" }] });

		const store = TestBed.inject(SessionStore);
		await vi.waitFor(function _Loaded() { expect(store.me.hasValue()).toBe(true); });

		expect(gateway.load).toHaveBeenCalledWith("org");
		expect(store.user()?.sub).toBe("user-1");
		expect(store.capabilities().isOperator).toBe(false);

		vi.stubGlobal("window", undefined);
		await store.logout();
		vi.unstubAllGlobals();
		expect(gateway.logout).toHaveBeenCalledWith("org");
	});
});
