import { afterEach, describe, expect, it, vi } from "vitest";

import { WebPlatformPreferenceStore } from "../web-platform-preference-store";

/** Restore runtime globals after every preference-store example. */
afterEach(function _RestoreGlobals(): void
{
	vi.unstubAllGlobals();
});

describe("WebPlatformPreferenceStore", function _Suite()
{
	it("reads, writes, and removes browser-local preferences", function _AvailableStorage()
	{
		const values = new Map<string, string>();
		const storage = {
			getItem: vi.fn(function _Read(key: string): string | null { return values.get(key) ?? null; }),
			setItem: vi.fn(function _Write(key: string, value: string): void { values.set(key, value); }),
			removeItem: vi.fn(function _Remove(key: string): void { values.delete(key); })
		};
		vi.stubGlobal("localStorage", storage);
		const preferences = new WebPlatformPreferenceStore();

		expect(preferences.read("archetype")).toBeNull();
		expect(preferences.write("archetype", "analyst")).toBe(true);
		expect(preferences.read("archetype")).toBe("analyst");
		preferences.remove("archetype");
		expect(preferences.read("archetype")).toBeNull();
	});

	it("treats unavailable storage as an empty preference store", function _UnavailableStorage()
	{
		vi.stubGlobal("localStorage", undefined);
		const preferences = new WebPlatformPreferenceStore();

		expect(preferences.read("archetype")).toBeNull();
		expect(preferences.write("archetype", "commander")).toBe(false);
		expect(function _Remove(): void { preferences.remove("archetype"); }).not.toThrow();
	});

	it("contains browser storage errors", function _DeniedStorage()
	{
		const storage = {
			getItem: vi.fn(function _Read(): never { throw new Error("denied"); }),
			setItem: vi.fn(function _Write(): never { throw new Error("denied"); }),
			removeItem: vi.fn(function _Remove(): never { throw new Error("denied"); })
		};
		vi.stubGlobal("localStorage", storage);
		const preferences = new WebPlatformPreferenceStore();

		expect(preferences.read("archetype")).toBeNull();
		expect(preferences.write("archetype", "anchor")).toBe(false);
		expect(function _Remove(): void { preferences.remove("archetype"); }).not.toThrow();
	});
});
