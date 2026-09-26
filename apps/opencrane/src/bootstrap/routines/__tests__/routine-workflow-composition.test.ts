import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RoutineOccurrenceTaskDeclaration, RoutineScheduleTaskDeclaration } from "@opencrane/backend/server/agents/scheduling";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

/** Captures the library dependencies selected by application composition. */
const _workflowDependencies = vi.hoisted(function _WorkflowDependencies() { return { value: null as unknown }; });

vi.mock("@opencrane/backend/server/agents/scheduling", async function _Scheduling(importOriginal)
{
	const original = await importOriginal<typeof import("@opencrane/backend/server/agents/scheduling")>();
	return { ...original, __CreateRoutineWorkflowDefinitions: function _CreateDefinitions(dependencies: unknown)
	{
		_workflowDependencies.value = dependencies;
		return original.__CreateRoutineWorkflowDefinitions(dependencies as never);
	} };
});

import { _CreateRoutineWorkflowComposition } from "../routine-workflow-composition";

/** Builds a payload cipher whose identity can be checked across the composed adapters. */
function _Cipher(): ConversationPrivatePayloadCipher
{
	return { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as ConversationPrivatePayloadCipher;
}

describe("routine workflow composition", function _RoutineWorkflowCompositionSuite()
{
	it("registers both routine handlers and shares recovery dependencies", function _RegistersRoutineHandlers()
	{
		const definitions: IWorkflowTaskDefinition<unknown, unknown>[] = [];
		const workflows = { register: function _Register(definition: IWorkflowTaskDefinition<unknown, unknown>) { definitions.push(definition); }, spawn: vi.fn(), declare: vi.fn() };
		const cipher = _Cipher();
		const membership = { mode: "test" } as never;
		const composition = _CreateRoutineWorkflowComposition({
			prisma: {} as PrismaClient,
			history: {} as never,
			customApi: {} as never,
			siloId: "silo-one",
			profile: { profileRevisionId: "profile-one", profileName: "developer", warmPoolName: "pool", namespace: "silo-one", serviceAccountName: "computer", leaseTtlMilliseconds: 60_000, maximumTurnCostUsdMicros: 75_000 },
			cipher,
			membership,
			workflows: workflows as never,
		});

		expect(definitions.map(definition => definition.taskName)).toEqual([RoutineScheduleTaskDeclaration.taskName, RoutineOccurrenceTaskDeclaration.taskName]);
		const dependencies = _workflowDependencies.value as { readonly persistence: unknown; readonly preparation: unknown; readonly activation: unknown; readonly runAdmission: unknown };
		const preparation = dependencies.preparation as { readonly dependencies: { readonly cipher: unknown; readonly history: unknown } };
		const runAdmission = dependencies.runAdmission as { readonly dependencies: { readonly cipher: unknown; readonly membership: unknown; readonly occurrences: unknown; readonly workflows: unknown } };
		const dispatcher = composition.dispatcher as unknown as { readonly dependencies: { readonly cipher: ConversationPrivatePayloadCipher; readonly membership: unknown; readonly workflows?: unknown } };
		expect(preparation.dependencies.cipher).toBe(cipher);
		expect(runAdmission.dependencies.cipher).toBe(cipher);
		expect(runAdmission.dependencies.membership).toBe(membership);
		expect(runAdmission.dependencies.occurrences).toBe(preparation.dependencies.history);
		expect(runAdmission.dependencies.workflows).toBe(workflows);
		expect(dispatcher.dependencies.cipher).toBe(cipher);
		expect(dispatcher.dependencies.membership).toBe(membership);
		expect(dispatcher.dependencies.workflows).toBeUndefined();
		expect(composition.progress).toBe(dependencies.persistence);
		expect(composition.startup.repairAllActiveSchedules).toBeTypeOf("function");
	});

	it("propagates task registration failure before any worker can start", function _RegistrationFailure()
	{
		const failure = new Error("registration failed");
		const workflows = { register: vi.fn(function _Register() { throw failure; }), spawn: vi.fn(), declare: vi.fn() };
		expect(function _Compose()
		{
			_CreateRoutineWorkflowComposition({
				prisma: {} as PrismaClient,
				history: {} as never,
				customApi: {} as never,
				siloId: "silo-one",
				profile: { profileRevisionId: "profile-one", profileName: "developer", warmPoolName: "pool", namespace: "silo-one", serviceAccountName: "computer", leaseTtlMilliseconds: 60_000, maximumTurnCostUsdMicros: 75_000 },
				cipher: _Cipher(),
				membership: {} as never,
				workflows: workflows as never,
			});
		}).toThrow(failure);
		expect(workflows.register).toHaveBeenCalledOnce();
	});
});
