import { describe, expect, it } from "vitest";

import { CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, ConversationComputerRuntimeCommandKinds, ConversationComputerRuntimeTerminalStates } from "../index";
import type { ConversationComputerRuntimeCommandEnvelope, ConversationComputerRuntimeTerminalReport } from "../index";

describe("ConversationComputer runtime protocol contracts", function ()
{
	it("binds a target command and terminal report to one execution generation without AgentRun coordinates", function ()
	{
		const command: ConversationComputerRuntimeCommandEnvelope = {
			protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION,
			commandId: "command-1",
			sequence: 1,
			computerId: "computer-1",
			executionId: "execution-1",
			leaseGeneration: 2,
			issuedAt: "2026-09-01T00:00:00.000Z",
			expiresAt: "2026-09-01T00:05:00.000Z",
			kind: ConversationComputerRuntimeCommandKinds.StartTurn,
			payload: { inputEntryId: "entry-1", inputPayloadRef: "payload://31c1f1dc-0010-4f13-9c2f-d3841ffd6651", inputPayloadDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
		};
		const terminal: ConversationComputerRuntimeTerminalReport = {
			protocolVersion: command.protocolVersion,
			commandId: command.commandId,
			computerId: command.computerId,
			executionId: command.executionId,
			leaseGeneration: command.leaseGeneration,
			state: ConversationComputerRuntimeTerminalStates.Completed,
		};

		expect(command.executionId).toBe(terminal.executionId);
		expect(command.leaseGeneration).toBe(terminal.leaseGeneration);
		expect(command.kind).not.toContain("attempt");
	});
});
