import { AgentRevisionState, AgentServiceKind } from "@prisma/client";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunAuthoritySource } from "../prisma-run-authority-source.js";

/** Creates the minimum command coordinates needed for a run-authority lookup. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind: "service", trigger: "managed_invocation", requestIdempotencyKey: "request-1", ...overrides } as never;
}

/** Creates the admission transaction facade with one controllable service row. */
function _Transaction(service: unknown): RunAdmissionTransaction
{
	return { prisma: { agentService: { findFirst: vi.fn().mockResolvedValue(service) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

/** Creates one active service row with an exact active published revision. */
function _Service(overrides: Record<string, unknown> = {})
{
	return {
		id: "service-1",
		kind: AgentServiceKind.Managed,
		activeRevisionId: "revision-1",
		activeRevision: { id: "revision-1", state: AgentRevisionState.Published, digest: `sha256:${"a".repeat(64)}`, promptPolicyVersion: "opencrane.prompt-compiler/1" },
		...overrides,
	};
}

describe("PrismaRunAuthoritySource", function _DescribePrismaRunAuthoritySource()
{
	it("loads only the same-silo active published revision for a managed invocation", async function _LoadsManagedInvocation()
	{
		await expect(new PrismaRunAuthoritySource().load(_Command(), _Transaction(_Service()))).resolves.toEqual({ outcome: "loaded", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "managed", effectiveContractDigest: `sha256:${"a".repeat(64)}`, promptCompilerVersion: "opencrane.prompt-compiler/1", trigger: "managed_invocation", delegatedUserId: null, rootRunId: "run-1", parentRunId: null } });
	});

	it("uses a schedule trigger only when a future command contract explicitly supplies one", async function _UsesScheduleTrigger()
	{
		const result = await new PrismaRunAuthoritySource().load(_Command({ trigger: "schedule" }), _Transaction(_Service()));
		if (result.outcome !== "loaded") throw new Error("expected active managed run authority");
		expect(result.value.trigger).toBe("schedule");
	});

	it("denies a missing service or an active pointer that does not name a published revision", async function _DeniesStaleAuthority()
	{
		await expect(new PrismaRunAuthoritySource().load(_Command(), _Transaction(null))).resolves.toEqual({ outcome: "denied", reason: "run_not_admittable" });
		await expect(new PrismaRunAuthoritySource().load(_Command(), _Transaction(_Service({ activeRevision: { id: "revision-1", state: AgentRevisionState.Draft, digest: `sha256:${"a".repeat(64)}`, promptPolicyVersion: "opencrane.prompt-compiler/1" } })))).resolves.toEqual({ outcome: "denied", reason: "revision_unavailable" });
	});

	it("denies a command whose tagged identity kind does not match the active service kind", async function _DeniesMismatchedIdentityKind()
	{
		await expect(new PrismaRunAuthoritySource().load(_Command({ identityKind: "user", trigger: "interactive", executionSubjectId: "user-1" }), _Transaction(_Service()))).resolves.toEqual({ outcome: "denied", reason: "run_not_admittable" });
	});

	it("binds a personal service to its authenticated execution subject and interactive trigger", async function _LoadsPersonal()
	{
		const result = await new PrismaRunAuthoritySource().load(_Command({ identityKind: "user", trigger: "interactive", executionSubjectId: "user-1" }), _Transaction(_Service({ kind: AgentServiceKind.Personal })));
		if (result.outcome !== "loaded") throw new Error("expected active personal run authority");
		expect(result.value).toMatchObject({ agentKind: "personal", trigger: "interactive", delegatedUserId: "user-1" });
	});
});
