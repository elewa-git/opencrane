import { AgentRevisionState, AgentServiceKind, AgentServiceState } from "@prisma/client";
import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { PrismaRootRunAuthoritySource } from "../prisma-root-run-authority-source.js";

/** Builds the fixed root admission command used for source revalidation. */
function _command()
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" };
}

/** Wraps one controlled service row in the final-admission transaction shape. */
function _transaction(service: unknown)
{
	return { prisma: { agentService: { findFirst: async function _findFirst() { return service; } } }, admittedAt: "2026-07-24T00:00:00.000Z", admittedAtEpochMs: 1 } as never;
}

describe("PrismaRootRunAuthoritySource", function _describePrismaRootRunAuthoritySource()
{
	it("freezes the active published personal revision into root interactive lineage", async function _loadsPublishedPersonalRevision()
	{
		const source = new PrismaRootRunAuthoritySource();
		const service = { id: "service-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", activeRevision: { id: "revision-1", state: AgentRevisionState.Published, digest: "sha256:contract", promptPolicyVersion: PROMPT_COMPILER_VERSION, personaRevisionId: "persona-1" } };
		await expect(source.load(_command(), _transaction(service))).resolves.toEqual({ outcome: "loaded", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: PROMPT_COMPILER_VERSION, trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null } });
	});

	it("refuses missing, inactive, draft, or mismatched active revisions", async function _deniesUnavailableRevision()
	{
		const source = new PrismaRootRunAuthoritySource();
		await expect(source.load(_command(), _transaction(null))).resolves.toEqual({ outcome: "denied", reason: "revision_unavailable" });
		const draft = { id: "service-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", activeRevision: { id: "revision-1", state: AgentRevisionState.Draft, digest: "sha256:contract", promptPolicyVersion: PROMPT_COMPILER_VERSION, personaRevisionId: "persona-1" } };
		await expect(source.load(_command(), _transaction(draft))).resolves.toEqual({ outcome: "denied", reason: "revision_unavailable" });
		await expect(source.load({ ..._command(), threadId: null }, _transaction({ ...draft, activeRevision: { ...draft.activeRevision, state: AgentRevisionState.Published } }))).resolves.toEqual({ outcome: "denied", reason: "run_not_admittable" });
		await expect(source.load(_command(), _transaction({ ...draft, kind: AgentServiceKind.Managed, activeRevision: { ...draft.activeRevision, state: AgentRevisionState.Published } }))).resolves.toEqual({ outcome: "denied", reason: "run_not_admittable" });
		await expect(source.load({ ..._command(), threadId: null }, _transaction({ ...draft, kind: AgentServiceKind.Managed, activeRevision: { ...draft.activeRevision, state: AgentRevisionState.Published } }))).resolves.toEqual({ outcome: "denied", reason: "run_not_admittable" });
	});

	it("refuses a published revision that targets another prompt compiler", async function _deniesIncompatibleCompiler()
	{
		const source = new PrismaRootRunAuthoritySource();
		const service = { id: "service-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", activeRevision: { id: "revision-1", state: AgentRevisionState.Published, digest: "sha256:contract", promptPolicyVersion: "opencrane.prompt-compiler/older", personaRevisionId: "persona-1" } };

		await expect(source.load(_command(), _transaction(service))).resolves.toEqual({ outcome: "denied", reason: "revision_unavailable" });
	});
});
