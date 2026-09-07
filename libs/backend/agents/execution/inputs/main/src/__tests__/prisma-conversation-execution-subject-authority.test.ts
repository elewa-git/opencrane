import { AgentServiceKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationExecutionSubjectAuthority } from "../prisma-conversation-execution-subject-authority";
import { PersonalMemoryPreferenceFactSource } from "../personal-memory-preference-fact-source";

const _COMMAND = { siloId: "silo-1", agentServiceId: "service-1" };
const _RUN = { agentServiceId: "service-1", agentRevisionId: "revision-1" };

describe("PrismaConversationExecutionSubjectAuthority", function _Suite()
{
	it.each([AgentServiceKind.Personal, AgentServiceKind.Managed])("dispatches current %s once and never retries a denied identity under another kind", async function _Dispatches(kind)
	{
		const personal = { load: vi.fn().mockResolvedValue({ outcome: "denied", reason: "identity_unavailable" }) };
		const managed = { load: vi.fn().mockResolvedValue({ outcome: "denied", reason: "identity_unavailable" }) };
		const transaction = { prisma: { agentService: { findFirst: vi.fn().mockResolvedValue({ kind }) } } };
		const authority = new PrismaConversationExecutionSubjectAuthority(transaction.prisma as never, personal, managed);
		expect(await authority.load(_COMMAND as never, _RUN as never, transaction as never)).toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(personal.load).toHaveBeenCalledTimes(kind === AgentServiceKind.Personal ? 1 : 0);
		expect(managed.load).toHaveBeenCalledTimes(kind === AgentServiceKind.Managed ? 1 : 0);
	});

	it("rejects missing current service authority before either identity handler runs", async function _RejectsMissing()
	{
		const personal = { load: vi.fn() };
		const managed = { load: vi.fn() };
		const authority = new PrismaConversationExecutionSubjectAuthority({ agentService: { findFirst: vi.fn().mockResolvedValue(null) } } as never, personal, managed);
		expect(await authority.load(_COMMAND as never, _RUN as never, { prisma: { agentService: { findFirst: vi.fn().mockResolvedValue(null) } } } as never)).toEqual({ outcome: "denied", reason: "identity_unavailable" });
		expect(personal.load).not.toHaveBeenCalled();
		expect(managed.load).not.toHaveBeenCalled();
	});
});

describe("PersonalMemoryPreferenceFactSource", function _Suite()
{
	it("returns no facts and never opens personal storage for a company policy without personal memory", async function _KeepsCompanyMemoryEmpty()
	{
		const factory = vi.fn();
		const source = new PersonalMemoryPreferenceFactSource(factory);
		await expect(source.load(_COMMAND as never, { executionPolicy: { personalMemory: "none" } } as never, {} as never, {} as never)).resolves.toEqual({ outcome: "loaded", value: [] });
		expect(factory).not.toHaveBeenCalled();
	});
});
