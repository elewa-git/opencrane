import { describe, expect, it, vi } from "vitest";

import { PersonalMemoryPreferenceFactSource } from "../personal-memory-preference-fact-source.js";

describe("PersonalMemoryPreferenceFactSource", function _DescribePersonalMemoryPreferenceFactSource()
{
	it("selects only metadata identifiers using verified personal identity", async function _LoadsVerifiedPreferenceIds()
	{
		const personalMemory = { findActivePreferenceFactIds: vi.fn().mockResolvedValue(["fact-2", "fact-1"]) };
		const transaction = { prisma: {} };
		const source = new PersonalMemoryPreferenceFactSource(personalMemory as never);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, transaction as never)).resolves.toEqual({ outcome: "loaded", value: [{ id: "fact-2" }, { id: "fact-1" }] });
		expect(personalMemory.findActivePreferenceFactIds).toHaveBeenCalledWith(transaction, { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" });
	});

	it("refuses a managed run before reading personal preference metadata", async function _RejectsManagedRun()
	{
		const personalMemory = { findActivePreferenceFactIds: vi.fn() };
		const source = new PersonalMemoryPreferenceFactSource(personalMemory as never);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "managed" } as never, { kind: "service" } as never, {} as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(personalMemory.findActivePreferenceFactIds).not.toHaveBeenCalled();
	});
});
