import { afterEach, describe, expect, it, vi } from "vitest";

import { PreparedFileOpenCompletionOutcomes, PreparedFileOpenModes } from "../platform-bridge.types";
import { WebPlatformBridge } from "../web-platform-bridge";

interface _Popup extends Pick<Window, "close" | "closed" | "location" | "opener">
{
	closed: boolean;
	opener: unknown;
}

interface _Anchor
{
	download: string;
	href: string;
	style: { display: string };
	click: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
}

function _PopupWindow(): _Popup
{
	const popup: _Popup = {
		closed: false,
		opener: {},
		location: { replace: vi.fn() } as unknown as Location,
		close: vi.fn(function _Close() { popup.closed = true; })
	};
	return popup;
}

function _ObjectUrls(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> }
{
	const create = vi.fn(function _CreateObjectUrl() { return "blob:opencrane-file"; });
	const revoke = vi.fn();
	vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
	return { create, revoke };
}

function _Document(anchor: _Anchor): ReturnType<typeof vi.fn>
{
	const append = vi.fn();
	vi.stubGlobal("document", {
		body: { append },
		createElement: vi.fn(function _CreateElement() { return anchor; })
	});
	return append;
}

describe("WebPlatformBridge prepared file actions", function _PreparedFileActions()
{
	afterEach(function _RestoreRuntime()
	{
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("reserves preview before completion and revokes its internal URL once", function _Preview()
	{
		vi.useFakeTimers();
		const popup = _PopupWindow();
		const open = vi.fn(function _Open() { return popup as Window; });
		vi.stubGlobal("open", open);
		const urls = _ObjectUrls();

		const reservation = new WebPlatformBridge().prepareFileOpen(PreparedFileOpenModes.Preview);
		expect(open).toHaveBeenCalledWith("about:blank", "_blank");
		expect(popup.opener).toBeNull();
		expect(urls.create).not.toHaveBeenCalled();
		expect(reservation).not.toBeNull();

		const blob = new Blob(["preview"], { type: "application/pdf" });
		expect(reservation?.complete(blob, "projected.pdf")).toBe(PreparedFileOpenCompletionOutcomes.Completed);
		expect(urls.create).toHaveBeenCalledOnce();
		expect(popup.location.replace).toHaveBeenCalledWith("blob:opencrane-file");
		expect(reservation?.complete(blob, "projected.pdf")).toBe(PreparedFileOpenCompletionOutcomes.Unavailable);

		reservation?.cancel();
		vi.advanceTimersByTime(120_000);
		expect(urls.revoke).toHaveBeenCalledOnce();
		expect(popup.close).not.toHaveBeenCalled();
	});

	it("returns no reservation when preview is blocked", function _BlockedPreview()
	{
		vi.stubGlobal("open", vi.fn(function _Block() { return null; }));
		const urls = _ObjectUrls();
		expect(new WebPlatformBridge().prepareFileOpen(PreparedFileOpenModes.Preview)).toBeNull();
		expect(urls.create).not.toHaveBeenCalled();
	});

	it("expires an unused preview and rejects late completion", function _ExpirePreview()
	{
		vi.useFakeTimers();
		const popup = _PopupWindow();
		vi.stubGlobal("open", vi.fn(function _Open() { return popup as Window; }));
		const urls = _ObjectUrls();
		const reservation = new WebPlatformBridge().prepareFileOpen(PreparedFileOpenModes.Preview);

		vi.advanceTimersByTime(30_000);
		expect(popup.close).toHaveBeenCalledOnce();
		expect(reservation?.complete(new Blob(["late"]), "late.pdf")).toBe(PreparedFileOpenCompletionOutcomes.Unavailable);
		expect(urls.create).not.toHaveBeenCalled();
	});

	it("cancels an unused preview without allocating a URL", function _CancelPreview()
	{
		vi.useFakeTimers();
		const popup = _PopupWindow();
		vi.stubGlobal("open", vi.fn(function _Open() { return popup as Window; }));
		const urls = _ObjectUrls();
		const reservation = new WebPlatformBridge().prepareFileOpen(PreparedFileOpenModes.Preview);

		reservation?.cancel();
		reservation?.cancel();
		vi.advanceTimersByTime(120_000);
		expect(popup.close).toHaveBeenCalledOnce();
		expect(urls.create).not.toHaveBeenCalled();
		expect(urls.revoke).not.toHaveBeenCalled();
	});

	it("downloads with the projected filename and revokes after browser consumption", function _Download()
	{
		vi.useFakeTimers();
		const urls = _ObjectUrls();
		const anchor: _Anchor = {
			download: "",
			href: "",
			style: { display: "" },
			click: vi.fn(),
			remove: vi.fn()
		};
		const append = _Document(anchor);
		const reservation = new WebPlatformBridge().prepareFileOpen(PreparedFileOpenModes.Download);

		const outcome = reservation?.complete(new Blob(["archive"]), "server-projected.zip");
		expect(outcome).toBe(PreparedFileOpenCompletionOutcomes.Completed);
		expect(anchor.download).toBe("server-projected.zip");
		expect(anchor.href).toBe("blob:opencrane-file");
		expect(anchor.style.display).toBe("none");
		expect(append).toHaveBeenCalledWith(anchor);
		expect(anchor.click).toHaveBeenCalledOnce();
		expect(anchor.remove).toHaveBeenCalledOnce();

		vi.advanceTimersByTime(60_000);
		reservation?.cancel();
		expect(urls.revoke).toHaveBeenCalledOnce();
	});

	it("reports a browser action failure and immediately revokes its URL", function _DownloadFailure()
	{
		vi.useFakeTimers();
		const urls = _ObjectUrls();
		const anchor: _Anchor = {
			download: "",
			href: "",
			style: { display: "" },
			click: vi.fn(function _RejectClick() { throw new Error("browser rejected click"); }),
			remove: vi.fn()
		};
		_Document(anchor);
		const reservation = new WebPlatformBridge().prepareFileOpen(PreparedFileOpenModes.Download);

		const outcome = reservation?.complete(new Blob(["archive"]), "archive.zip");
		expect(outcome).toBe(PreparedFileOpenCompletionOutcomes.Unavailable);
		expect(anchor.remove).toHaveBeenCalledOnce();
		expect(urls.revoke).toHaveBeenCalledOnce();
		reservation?.cancel();
		expect(urls.revoke).toHaveBeenCalledOnce();
	});
});
