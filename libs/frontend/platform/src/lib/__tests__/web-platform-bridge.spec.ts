import { afterEach, describe, expect, it, vi } from "vitest";

import { WebPlatformBridge } from "../web-platform-bridge.js";

describe("WebPlatformBridge authentication windows", function _AuthenticationWindows()
{
	afterEach(function _RestoreRuntime()
	{
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("reports closure once and releases its observer", function _ReportClosure()
	{
		vi.useFakeTimers();
		const popup = { closed: false } as Window;
		const onClosed = vi.fn();
		const open = vi.fn(function _OpenWindow() { return popup; });
		vi.stubGlobal("open", open);

		const observation = new WebPlatformBridge().openAuthenticationWindow("/api/v1/auth/reauthenticate", onClosed);
		expect(open).toHaveBeenCalledWith("/api/v1/auth/reauthenticate", "opencrane-step-up", "popup,width=560,height=720");
		expect(observation).not.toBeNull();

		popup.closed = true;
		vi.advanceTimersByTime(500);
		expect(onClosed).toHaveBeenCalledTimes(1);
	});

	it("returns null when the runtime blocks the window", function _BlockedWindow()
	{
		vi.stubGlobal("open", vi.fn(function _BlockWindow() { return null; }));
		expect(new WebPlatformBridge().openAuthenticationWindow("/api/v1/auth/reauthenticate", vi.fn())).toBeNull();
	});
});
