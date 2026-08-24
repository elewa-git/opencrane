import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ConversationAssetDisposition } from "@opencrane/models/conversation-assets";

import { __CreateConversationAssetRouter } from "../conversation-asset.router";

const _CALLER = { siloId: "silo-1", subjectId: "user-1", principalId: "principal-1" } as const;

/** Build the public asset router with a participant caller and controlled authority. */
function _App(authority: Record<string, unknown>, caller: typeof _CALLER | null = _CALLER)
{
	const logger = { error: vi.fn() };
	const app = express();
	app.use(express.json());
	app.use(__CreateConversationAssetRouter({ resolveCaller: vi.fn().mockReturnValue(caller), authority: authority as never, logger }));
	return { app, logger };
}

describe("conversation asset content route", function _Suite()
{
	it("streams only authorized ready bytes with safe preview headers", async function _ReadsReadyAsset()
	{
		const authority = { read: vi.fn().mockResolvedValue({ displayName: "Q3 brief ü.pdf", mediaType: "application/pdf", byteLength: 5, disposition: ConversationAssetDisposition.Preview, bytes: (async function* _Bytes() { yield Buffer.from("proof"); })() }) };
		const response = await request(_App(authority).app).get("/conversation-1/assets/asset-1/content");

		expect(response.status).toBe(200);
		expect(response.body).toEqual(Buffer.from("proof"));
		expect(response.headers["content-type"]).toBe("application/pdf");
		expect(response.headers["content-length"]).toBe("5");
		expect(response.headers["content-disposition"]).toBe("inline; filename*=UTF-8''Q3%20brief%20%C3%BC.pdf");
		expect(response.headers["cache-control"]).toBe("private, no-store");
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
		expect(authority.read).toHaveBeenCalledWith(_CALLER, "conversation-1", "asset-1");
	});

	it("uses attachment disposition for download-only media", async function _DownloadsCheckedAsset()
	{
		const authority = { read: vi.fn().mockResolvedValue({ displayName: "report.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteLength: 1, disposition: ConversationAssetDisposition.Download, bytes: (async function* _Bytes() { yield Buffer.from("x"); })() }) };
		const response = await request(_App(authority).app).get("/conversation-1/assets/asset-1/content");
		expect(response.status).toBe(200);
		expect(response.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''report.docx");
	});

	it("returns one opaque not-found response when access or ready state is absent", async function _Unavailable()
	{
		const authority = { read: vi.fn().mockResolvedValue(null) };
		const response = await request(_App(authority).app).get("/conversation-1/assets/asset-1/content");
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "asset_unavailable" });
		expect(response.text).not.toContain("lease");
		expect(response.text).not.toContain("revision");
	});

	it("rejects unauthenticated reads before asking the authority", async function _Unauthorized()
	{
		const authority = { read: vi.fn() };
		const response = await request(_App(authority, null).app).get("/conversation-1/assets/asset-1/content");
		expect(response.status).toBe(401);
		expect(authority.read).not.toHaveBeenCalled();
	});

	it("returns service unavailable when upload scanning is disabled", async function _ScannerUnavailable()
	{
		const authority = { reserveUpload: vi.fn().mockResolvedValue({ outcome: "denied", reason: "scanner_unavailable" }) };
		const response = await request(_App(authority).app).post("/conversation-1/assets").send({ idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"a".repeat(64)}` });

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ outcome: "denied", reason: "scanner_unavailable" });
	});
});
