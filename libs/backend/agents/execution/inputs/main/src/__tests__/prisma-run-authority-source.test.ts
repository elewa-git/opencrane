import { AgentRevisionState, AgentServiceKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies } from "@opencrane/backend/agents/execution/runs";

import { PersonalMemoryPreferenceFactSource } from "../personal-memory-preference-fact-source";
import { PersonalMemoryScopeSource } from "../personal-memory-scope-source";
import { PrismaRunAuthority } from "../prisma-run-authority-source";
import { RunPolicyMemoryScopeSource } from "../run-policy-memory-scope-source";

/** Loads a published service through the production policy adapter. */
async function _LoadAuthority(kind: AgentServiceKind)
{
	const prisma = { agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", kind, activeRevisionId: "revision-1", activeRevision: { id: "revision-1", state: AgentRevisionState.Published, promptPolicyVersion: "v1" } }) } };
	const source = new PrismaRunAuthority(prisma as never);
	const result = await source.load({ siloId: "silo-1", agentServiceId: "service-1", trigger: "interactive" } as never, {} as never);
	if (result.outcome === "denied")
		throw new Error("The fixture must load a published service");
	return result.value;
}

describe("PrismaRunAuthority text-chat policy", function _Suite()
{
	it.each([
		{ kind: AgentServiceKind.Personal, persona: RunExecutionPersonaPolicies.Required },
		{ kind: AgentServiceKind.Managed, persona: RunExecutionPersonaPolicies.None },
	])("admits $kind text inputs without opening memory storage", async function _SkipsUnprovisionedMemory({ kind, persona })
	{
		const run = await _LoadAuthority(kind);
		expect(run.executionPolicy).toEqual({ persona, personalMemory: RunExecutionPersonalMemoryPolicies.None });
		const repositoryFactory = vi.fn();
		const preferences = new PersonalMemoryPreferenceFactSource(repositoryFactory);
		const memory = new RunPolicyMemoryScopeSource(new PersonalMemoryScopeSource(repositoryFactory));
		await expect(preferences.load({} as never, run, {} as never, {} as never)).resolves.toEqual({ outcome: "loaded", value: [] });
		await expect(memory.load({} as never, run, {} as never, { messageIds: [] }, {} as never)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" }, datasetId: null } });
		expect(repositoryFactory).not.toHaveBeenCalled();
	});

	it("still denies an explicitly enabled memory policy when its dataset is missing", async function _RefusesMissingEnabledDataset()
	{
		const run = await _LoadAuthority(AgentServiceKind.Personal);
		const enabled = { ...run, executionPolicy: { ...run.executionPolicy, personalMemory: RunExecutionPersonalMemoryPolicies.Allowed } };
		const repository = { findActivePersonalDataset: vi.fn().mockResolvedValue(null), findActivePreferenceFactIds: vi.fn() };
		const factory = vi.fn().mockReturnValue(repository);
		const memory = new RunPolicyMemoryScopeSource(new PersonalMemoryScopeSource(factory));
		await expect(memory.load({ siloId: "silo-1" } as never, enabled, { principalId: "principal-1" } as never, { messageIds: [] }, {} as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(repository.findActivePersonalDataset).toHaveBeenCalledOnce();
	});
});
