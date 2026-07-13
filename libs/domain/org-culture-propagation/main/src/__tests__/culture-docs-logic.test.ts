import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { _PublishCultureDocVersion } from "../core/culture-docs.logic.js";

describe("_PublishCultureDocVersion (P4C.3 immutable versioning)", function _suite()
{
	it("appends the next version and bumps currentVersion in a transaction", async function _publish()
	{
		const upsert = vi.fn().mockResolvedValue({ id: "doc-1", currentVersion: 2 });
		const create = vi.fn().mockResolvedValue({});
		const update = vi.fn().mockResolvedValue({});
		const tx = { cultureDoc: { upsert, update }, cultureDocVersion: { create } };
		const prisma = {
			$transaction: vi.fn().mockImplementation(function _run(fn: (t: typeof tx) => unknown) { return fn(tx); }),
		} as unknown as PrismaClient;

		const result = await _PublishCultureDocVersion(prisma, "SOUL", "# Voice\nWarm and precise.", "alex@acme.com");

		// Version 3 follows the existing currentVersion of 2 — immutable append, never overwrite.
		expect(result).toEqual({ name: "SOUL", version: 3 });
		expect(create).toHaveBeenCalledWith({ data: { cultureDocId: "doc-1", version: 3, content: "# Voice\nWarm and precise.", createdBy: "alex@acme.com" } });
		expect(update).toHaveBeenCalledWith({ where: { id: "doc-1" }, data: { currentVersion: 3 } });
	});

	it("rejects content carrying L0 directives before any write", async function _l0()
	{
		const prisma = { $transaction: vi.fn() } as unknown as PrismaClient;
		await expect(_PublishCultureDocVersion(prisma, "SOUL", "Operate in managed mode.", "alex@acme.com")).rejects.toThrow(/L0 system-mechanic/);
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});
});
