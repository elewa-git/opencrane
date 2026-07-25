import { AgentRevisionState, AgentServiceKind } from "@prisma/client";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunAuthoritySource } from "../prisma-run-authority-source.js";

/** Immutable command used for source-level authority checks. */
const _COMMAND = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: null, executionSubjectId: "user-1", requestIdempotencyKey: "request-1" };

/** Builds a transaction whose active-service read can be controlled per test. */
function _transaction(service: unknown): RunAdmissionTransaction
{
	return { prisma: { agentService: { findFirst: vi.fn().mockResolvedValue(service) } } as never, admittedAt: "2026-07-25T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-25T00:00:00.000Z") };
}

/** Builds the minimal active service and active revision row returned by Prisma. */
function _service(overrides: Record<string, unknown> = {})
{
	return {
		id: "service-1",
		kind: AgentServiceKind.Managed,
		activeRevisionId: "revision-1",
		activeRevision: { id: "revision-1", state: AgentRevisionState.Published, digest: `sha256:${"a".repeat(64)}`, promptPolicyVersion: "opencrane.prompt-compiler/1" },
		...overrides,
	};
}

describe("PrismaRunAuthoritySource", function _suite()
{
	it("loads the exact active published managed revision at the admission fence", async function _loadsManaged()
	{
		const result = await new PrismaRunAuthoritySource().load(_COMMAND, _transaction(_service()));
		expect(result).toEqual({ outcome: "loaded", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "managed", effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "opencrane.prompt-compiler/1", trigger: "managed_invocation", delegatedUserId: null, rootRunId: "run-1", parentRunId: null } });
	});

	it("denies an absent active service and a stale active revision", async function _deniesStale()
	{
		await expect(new PrismaRunAuthoritySource().load(_COMMAND, _transaction(null))).resolves.toEqual({ outcome: "denied", reason: "run_not_admittable" });
		const stale = _service({ activeRevision: { id: "revision-1", state: AgentRevisionState.Draft, digest: `sha256:${"a".repeat(64)}`, promptPolicyVersion: "opencrane.prompt-compiler/1" } });
		await expect(new PrismaRunAuthoritySource().load(_COMMAND, _transaction(stale))).resolves.toEqual({ outcome: "denied", reason: "revision_unavailable" });
	});

	it("uses interactive delegation only for personal services", async function _loadsPersonal()
	{
		const result = await new PrismaRunAuthoritySource().load(_COMMAND, _transaction(_service({ kind: AgentServiceKind.Personal })));
		if (result.outcome !== "loaded") throw new Error("expected loaded result");
		expect(result.value.trigger).toBe("interactive");
		expect(result.value.delegatedUserId).toBe("user-1");
	});
});
