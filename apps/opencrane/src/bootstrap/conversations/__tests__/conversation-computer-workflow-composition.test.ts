import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ConversationComputerRunAdmissionPort, RoutineTurnDispatcher } from "@opencrane/backend/server/conversations";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

/** Captures the arguments supplied to the turn unit of work by app composition. */
const _turnArguments = vi.hoisted(function _TurnArguments() { return { value: [] as unknown[] }; });

vi.mock("@opencrane/backend/server/conversations", async function _Conversations(importOriginal)
{
	const original = await importOriginal<typeof import("@opencrane/backend/server/conversations")>();
	return { ...original, PrismaConversationComputerTurnUnitOfWork: class
	{
		/** Records the constructor boundary without replacing any domain behaviour under test. */
		public constructor(...args: unknown[]) { _turnArguments.value = args; }
	} };
});

import { _CreateConversationComputerWorkflowComposition } from "../conversation-computer-workflow-composition";

describe("conversation computer workflow composition", function _ConversationComputerWorkflowCompositionSuite()
{
	it("passes ordinary admission and routine recovery to their distinct constructor positions", function _TurnComposition()
	{
		const runAdmission = { admit: vi.fn() } as unknown as ConversationComputerRunAdmissionPort;
		const routineTurns = { dispatch: vi.fn() } as unknown as RoutineTurnDispatcher;
		const routineProgress = { recordRunProgress: vi.fn() };
		const cipher = { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as ConversationPrivatePayloadCipher;
		_CreateConversationComputerWorkflowComposition({
			prisma: {} as PrismaClient,
			history: {} as never,
			kubernetes: { authApi: {} as never, coreApi: {} as never, customApi: {} as never },
			siloId: "silo-one",
			profile: { profileRevisionId: "profile-one", profileName: "developer", warmPoolName: "pool", namespace: "silo-one", serviceAccountName: "computer", leaseTtlMilliseconds: 60_000, maximumTurnCostUsdMicros: 75_000 },
			keyring: { currentKeyId: "key-one", keys: { "key-one": Buffer.alloc(32, 1).toString("base64url") } },
			cipher,
			membership: {} as never,
			runAdmission,
			routineTurns,
			routineProgress,
			runtimeAdmission: {} as never,
			toolDispatch: {} as never,
			workflows: { register: vi.fn(), spawn: vi.fn(), declare: vi.fn() } as never,
			generatedFiles: {} as never,
			generatedOutput: {} as never,
		});

		expect(_turnArguments.value[2]).toBe(cipher);
		expect(_turnArguments.value[4]).toBe(runAdmission);
		expect(_turnArguments.value[5]).toBe(routineTurns);
	});
});
