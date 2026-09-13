import { describe, expect, it, vi } from "vitest";

import { _ConversationComputerStopAuthority } from "../conversation-computer-stop-authority";
import { ConversationComputerStopDenied } from "../conversation-computer-stop-denied";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, ConversationComputerStopStatuses, type ConversationComputerStopCommand } from "../conversation-computer-stop.types";

const _COMMAND: ConversationComputerStopCommand = { commandId: "stop-1", siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", generation: 2, causationId: "message-stop", causationPosition: "8", requester: { principalId: "principal-1", subjectId: "user-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-11T10:00:00.000Z" } };
const _TARGET = { bootstrapId: "bootstrap-1", runId: "run-1", attempt: 1, leaseId: "lease-1", leaseGeneration: 2 };
const _TASK = { taskId: "turn-task-1", taskName: "conversation-computer-turn", idempotencyKey: "activation-1" };
const _SELECTION = { kind: ConversationComputerStopAdmissionKinds.Target, command: _COMMAND, commandDigest: "sha256:command", target: _TARGET, originalTurnTask: _TASK, activeTurnStreamName: "active-1", activeTurnExpectedRevision: "2", authorizationDecisionDigest: "sha256:decision" } as const;

function _Publisher(overrides: Record<string, unknown> = {})
{
	return { recover: vi.fn().mockResolvedValue(null), recoverSelection: vi.fn().mockResolvedValue(null), select: vi.fn(), publish: vi.fn(), ...overrides };
}

describe("conversation computer Stop authority", function _Suite()
{
	it("recovers a terminal receipt before reading or resolving another target", async function _RecoversFirst()
	{
		const read = vi.fn();
		const resolve = vi.fn();
		const recover = vi.fn().mockResolvedValue({ decision: ConversationComputerStopDecisions.CancellationWon, published: false, outputReceiptDigest: null });
		const authority = new _ConversationComputerStopAuthority({ read, admit: vi.fn() }, { resolve }, _Publisher({ recover }));
		await expect(authority.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.Idempotent });
		expect(read).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it("admits the exact predecessor once and reports durable acceptance", async function _AdmitsTarget()
	{
		const admit = vi.fn().mockResolvedValue({ kind: ConversationComputerStopAdmissionKinds.Target });
		const authority = new _ConversationComputerStopAuthority({ read: vi.fn().mockResolvedValue(null), admit }, { resolve: vi.fn().mockResolvedValue(_SELECTION) }, _Publisher({ select: vi.fn().mockResolvedValue(_SELECTION) }));
		await expect(authority.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.Accepted });
		expect(admit).toHaveBeenCalledWith(_COMMAND, _SELECTION);
	});

	it("resumes the exact saved target selection without resolving another turn", async function _ResumesSelection()
	{
		const admit = vi.fn().mockResolvedValue({ kind: ConversationComputerStopAdmissionKinds.Target });
		const resolve = vi.fn();
		const select = vi.fn();
		const authority = new _ConversationComputerStopAuthority({ read: vi.fn().mockResolvedValue(null), admit }, { resolve }, _Publisher({ recoverSelection: vi.fn().mockResolvedValue(_SELECTION), select }));
		await expect(authority.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.Accepted });
		expect(admit).toHaveBeenCalledWith(_COMMAND, _SELECTION);
		expect(resolve).not.toHaveBeenCalled();
		expect(select).not.toHaveBeenCalled();
	});

	it("writes no-target only against the checked active pointer", async function _PublishesNoTarget()
	{
		const resolution = { kind: ConversationComputerStopAdmissionKinds.NoTarget, commandDigest: "sha256:command", activeTurnStreamName: "active-1", activeTurnExpectedRevision: "3", authorizationDecisionDigest: "sha256:decision" } as const;
		const selection = { command: _COMMAND, ...resolution };
		const recover = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ decision: ConversationComputerStopDecisions.NoTarget, published: false, outputReceiptDigest: null });
		const select = vi.fn().mockResolvedValue(selection);
		const authority = new _ConversationComputerStopAuthority({ read: vi.fn().mockResolvedValue(null), admit: vi.fn() }, { resolve: vi.fn().mockResolvedValue(resolution) }, _Publisher({ recover, select }));
		await expect(authority.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.NothingToStop });
		expect(select).toHaveBeenCalledWith(_COMMAND, resolution);
	});

	it("denies when no relational lease can identify an authoritative pointer", async function _DeniesNoLease()
	{
		const publisher = _Publisher();
		const authority = new _ConversationComputerStopAuthority({ read: vi.fn().mockResolvedValue(null), admit: vi.fn() }, { resolve: vi.fn().mockResolvedValue(null) }, publisher);
		await expect(authority.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.Denied });
		expect(publisher.select).not.toHaveBeenCalled();
	});

	it("acknowledges a permanent requester refusal without hiding storage failures", async function _TypedDenial()
	{
		const denied = new _ConversationComputerStopAuthority({ read: vi.fn().mockRejectedValue(new ConversationComputerStopDenied("revoked")), admit: vi.fn() }, { resolve: vi.fn() }, _Publisher());
		await expect(denied.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.Denied });
		const unavailable = new _ConversationComputerStopAuthority({ read: vi.fn().mockRejectedValue(new Error("database unavailable")), admit: vi.fn() }, { resolve: vi.fn() }, _Publisher());
		await expect(unavailable.stop(_COMMAND)).rejects.toThrow("database unavailable");
	});

	it("does not write a target selection after current requester authority is denied", async function _DeniesBeforeSelection()
	{
		const publisher = _Publisher();
		const authority = new _ConversationComputerStopAuthority({ read: vi.fn().mockResolvedValue(null), admit: vi.fn() }, { resolve: vi.fn().mockRejectedValue(new ConversationComputerStopDenied("foreign requester")) }, publisher);
		await expect(authority.stop(_COMMAND)).resolves.toEqual({ status: ConversationComputerStopStatuses.Denied });
		expect(publisher.select).not.toHaveBeenCalled();
	});
});
