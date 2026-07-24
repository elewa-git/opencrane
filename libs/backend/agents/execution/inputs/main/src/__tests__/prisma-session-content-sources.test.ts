import { ConversationMessageState, ConversationThreadState, PersonaRevisionState } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PrismaApprovedPersonaSource } from "../prisma-approved-persona-source.js";
import { PrismaThreadContextSource } from "../prisma-thread-context-source.js";

/** Builds one personal interactive authority already admitted at the root-run boundary. */
function _personalRun()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null } as const;
}

/** Builds the caller-derived command used by every personal source. */
function _command(threadId: string | null = "thread-1")
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId, executionSubjectId: "user-1", requestIdempotencyKey: "request-1" };
}

/** Creates a transaction fixture whose read ports return only the supplied product rows. */
function _transaction(profile: unknown, thread: unknown)
{
	return { prisma: { personaProfile: { findFirst: async function _profile() { return profile; } }, agentRevision: { findFirst: async function _revision() { return { personaRevisionId: "persona-1" }; } }, conversationThread: { findFirst: async function _thread() { return thread; } }, $queryRaw: async function _lock() { return [{ userId: "user-1" }]; } }, admittedAt: "2026-07-24T00:00:00.000Z", admittedAtEpochMs: 1 } as never;
}

describe("Prisma session content sources", function _describePrismaSessionContentSources()
{
	it("freezes only the caller's active approved persona revision", async function _loadsApprovedPersona()
	{
		const source = new PrismaApprovedPersonaSource();
		const profile = { activeRevisionId: "persona-1", activeRevision: { id: "persona-1", state: PersonaRevisionState.Approved } };
		await expect(source.load(_command(), _personalRun(), _transaction(profile, null))).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: "persona-1" } });
		await expect(source.load(_command(), _personalRun(), _transaction({ activeRevisionId: "persona-1", activeRevision: { id: "persona-1", state: PersonaRevisionState.Draft } }, null))).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		const mismatch = { prisma: { personaProfile: { findFirst: async function _profile() { return profile; } }, agentRevision: { findFirst: async function _revision() { return { personaRevisionId: "persona-2" }; } } }, admittedAt: "2026-07-24T00:00:00.000Z", admittedAtEpochMs: 1 } as never;
		await expect(source.load(_command(), _personalRun(), mismatch)).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
	});

	it("returns no persona for managed work", async function _omitsManagedPersona()
	{
		const source = new PrismaApprovedPersonaSource();
		await expect(source.load(_command(), { ..._personalRun(), agentKind: "managed", delegatedUserId: null, trigger: "managed_invocation" }, _transaction(null, null))).resolves.toEqual({ outcome: "loaded", value: { personaRevisionId: null } });
	});

	it("freezes completed messages only after the exact participant thread is authoritative", async function _loadsCompletedThread()
	{
		const source = new PrismaThreadContextSource();
		const thread = { messages: [{ id: "message-1" }, { id: "message-2" }] };
		await expect(source.load(_command(), _personalRun(), _transaction(null, thread))).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2"] } });
		await expect(source.load(_command(), _personalRun(), _transaction(null, null))).resolves.toEqual({ outcome: "denied", reason: "thread_unavailable" });
		await expect(source.load(_command(null), _personalRun(), _transaction(null, thread))).resolves.toEqual({ outcome: "loaded", value: { messageIds: [] } });
	});

	it("uses the reviewed active and completed-state query constraints", async function _usesNarrowThreadQuery()
	{
		const calls: unknown[] = [];
		const transaction = { prisma: { conversationThread: { findFirst: async function _thread(query: unknown) { calls.push(query); return { messages: [] }; } }, $queryRaw: async function _lock() { return [{ userId: "user-1" }]; } }, admittedAt: "2026-07-24T00:00:00.000Z", admittedAtEpochMs: 1 } as never;
		await new PrismaThreadContextSource().load(_command(), _personalRun(), transaction);
		expect(calls[0]).toEqual(expect.objectContaining({ where: expect.objectContaining({ state: ConversationThreadState.Active, participants: { some: { userId: "user-1" } } }), select: expect.objectContaining({ messages: expect.objectContaining({ where: { state: ConversationMessageState.Completed } }) }) }));
	});
});
