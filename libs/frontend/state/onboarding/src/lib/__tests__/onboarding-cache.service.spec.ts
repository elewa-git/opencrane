import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it } from "vitest";

import { OnboardingSelection, OnboardingStep } from "../onboarding.types";
import { SESSION_STORAGE_GATEWAY, StorageGateway } from "@opencrane/state/utils/storage";

import { OnboardingCacheService } from "../onboarding-cache.service";

/** Minimal in-memory stub of StorageGateway for testing without a real browser API. */
class MockStorageGateway implements StorageGateway
{
	private readonly _store = new Map<string, string>();

	public getItem(key: string): string | null
	{
		return this._store.get(key) ?? null;
	}

	public setItem(key: string, value: string): void
	{
		this._store.set(key, value);
	}

	public removeItem(key: string): void
	{
		this._store.delete(key);
	}

	/** Test helper to seed storage directly. */
	public __seed(key: string, value: string): void
	{
		this._store.set(key, value);
	}
}

describe("OnboardingCacheService", () =>
{
	/** Key used by the service internally. */
	const STATE_KEY = "weownai.onboarding.state";

	/** Helper to spin up the service in an isolated injection context with a fresh mock gateway. */
	function _setup(): { service: OnboardingCacheService; mockGateway: MockStorageGateway }
	{
		const mockGateway = new MockStorageGateway();
		const injector = Injector.create({
			providers: [
				{ provide: SESSION_STORAGE_GATEWAY, useValue: mockGateway },
				{ provide: OnboardingCacheService, useClass: OnboardingCacheService }
			]
		});

		const service = runInInjectionContext(injector, () => injector.get(OnboardingCacheService));
		return { service, mockGateway };
	}

	it("returns null when restoring from an empty storage", () =>
	{
		const { service } = _setup();

		expect(service.restoreState()).toBeNull();
	});

	it("returns null and ignores malformed JSON", () =>
	{
		const { service, mockGateway } = _setup();
		mockGateway.__seed(STATE_KEY, "not json {");

		expect(service.restoreState()).toBeNull();
	});

	it("returns null if the parsed object is missing expected properties", () =>
	{
		const { service, mockGateway } = _setup();
		mockGateway.__seed(STATE_KEY, JSON.stringify({ wrong: "shape" }));

		expect(service.restoreState()).toBeNull();
	});

	it("rejects structurally present but invalid cached domain values", () =>
	{
		const { service, mockGateway } = _setup();
		const account = { displayName: "Acme", adminEmail: "a@b.com", baseDomain: "a.com", name: "acme" };
		const invalidStates = [
			{ step: "Account", selection: { planId: "pro", account } },
			{ step: OnboardingStep.Account, selection: null },
			{ step: OnboardingStep.Account, selection: { planId: 7, account } },
			{ step: OnboardingStep.Account, selection: { planId: "pro", account: { ...account, adminEmail: false } } },
		];

		for (const invalidState of invalidStates)
		{
			mockGateway.__seed(STATE_KEY, JSON.stringify(invalidState));
			expect(service.restoreState()).toBeNull();
		}
	});

	it("successfully parses and returns a valid saved state", () =>
	{
		const { service, mockGateway } = _setup();
		const validState = {
			step: OnboardingStep.Account,
			selection: {
				planId: "pro",
				account: { displayName: "Acme", adminEmail: "a@b.com", baseDomain: "a.com", name: "acme" }
			} as OnboardingSelection
		};
		mockGateway.__seed(STATE_KEY, JSON.stringify(validState));

		const restored = service.restoreState();
		expect(restored).not.toBeNull();
		expect(restored?.step).toBe(OnboardingStep.Account);
		expect(restored?.selection.planId).toBe("pro");
	});

	it("serializes the state to JSON and writes it to the gateway on saveState", () =>
	{
		const { service, mockGateway } = _setup();
		const stateToSave = {
			step: OnboardingStep.SignUp,
			selection: {
				planId: null,
				account: { displayName: "Test", adminEmail: "t@b.com", baseDomain: "t.com", name: "test" }
			} as OnboardingSelection
		};

		service.saveState(stateToSave);

		const raw = mockGateway.getItem(STATE_KEY);
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw!);
		expect(parsed.step).toBe(OnboardingStep.SignUp);
		expect(parsed.selection.account.displayName).toBe("Test");
	});

	it("removes the key from the gateway on clearState", () =>
	{
		const { service, mockGateway } = _setup();
		mockGateway.__seed(STATE_KEY, '{"step": 1, "selection": {}}');

		service.clearState();

		expect(mockGateway.getItem(STATE_KEY)).toBeNull();
	});
});
