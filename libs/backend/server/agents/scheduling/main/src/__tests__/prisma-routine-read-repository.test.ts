import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, AgentRoutineStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RoutineFiringReasons } from "@opencrane/contracts";
import { AgentRunTerminalReasons, RoutineStatus } from "@opencrane/models/agents";

import { RoutineCommandUnavailableError } from "../routine-command.errors";
import { PrismaRoutineReadRepository } from "../prisma-routine-read-repository";
import type { RoutineFactsRepository } from "../routine-prisma-facts.types";
import { _CALLER, _Current, _Facts, _NOW } from "./prisma-routine-test-fixtures";

/** Builds transaction-scoped collaborators for the authorized read owner. */
function _Repository(options: { readonly current?: ReturnType<typeof _Current>; readonly firingRows?: readonly Record<string, unknown>[] } = {})
{
	const current = options.current ?? _Current();
	const rows = options.firingRows ?? [];
	const agentRoutineFiring = {
		findFirst: vi.fn().mockResolvedValue(null),
		findMany: vi.fn().mockResolvedValue(rows),
	};
	const routineFindMany = vi.fn().mockResolvedValue([]);
	const transaction = { agentRoutine: { findMany: routineFindMany }, agentRoutineFiring };
	const facts = _Facts(current);
	const conversations = {
		projectAudience: vi.fn().mockResolvedValue([{ participantRef: "member-1", displayName: "Requester", isSelf: true }, { participantRef: "member-2", displayName: "Former member", isSelf: false }]),
		creationAudience: vi.fn().mockResolvedValue([{ participantRef: "member-1", displayName: "Requester", isSelf: true }]),
		readableConversationIds: vi.fn().mockResolvedValue([]),
		resolveAudience: vi.fn(),
	};
	const managedServices = { list: vi.fn().mockResolvedValue([{ agentServiceId: "service-1", name: "Research assistant" }]), eligible: vi.fn().mockResolvedValue({ agentServiceId: "service-1" }) };
	const runHistory = { read: vi.fn().mockResolvedValue([]) };
	const repository = new PrismaRoutineReadRepository(transaction as unknown as Prisma.TransactionClient, facts as unknown as RoutineFactsRepository, conversations, managedServices, runHistory);
	return { repository, facts, conversations, managedServices, runHistory, agentRoutineFiring, routineFindMany };
}

/** Builds one saved refused firing with no run or result. */
function _Refused(reason: string)
{
	return { id: "firing-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 2, trigger: AgentRoutineFiringTrigger.Automatic, disposition: AgentRoutineFiringDisposition.Refused, scheduledSlot: new Date("2026-09-25T12:00:00.000Z"), conversationId: "occurrence-1", runId: null, preparationReceipt: null, refusalReason: reason, resultReference: null, resultDigest: null, createdAt: new Date("2026-09-25T12:00:00.000Z"), finishedAt: new Date("2026-09-25T12:00:01.000Z"), revision: { revision: 2, routineId: "routine-1", siloId: "silo-1" } };
}

/** Builds one completed firing with publication and result evidence. */
function _Completed(patch: Record<string, unknown> = {})
{
	return { ..._Refused("current_authority_or_audience_refused"), disposition: AgentRoutineFiringDisposition.Completed, runId: "run-1", preparationReceipt: { receiptId: "preparation-1", historyReference: "routine-occurrence-instruction-occurrence-1", digest: `sha256:${"a".repeat(64)}` }, refusalReason: null, resultReference: "conversation-occurrence-1#answer-1", resultDigest: `sha256:${"b".repeat(64)}`, ...patch };
}

describe("PrismaRoutineReadRepository", function _Suite()
{
	it.each([AgentRoutineStatus.Active, AgentRoutineStatus.Paused])("requires the complete current audience before reading %s", async function _CurrentAudience(status)
	{
		const f = _Repository({ current: _Current({ status }) });
		f.facts.requireCurrentAudience.mockRejectedValue(new RoutineCommandUnavailableError("audience revoked"));

		await expect(f.repository.read({ caller: _CALLER, routineId: "routine-1" })).resolves.toBeNull();
		expect(f.facts.requireCurrentAudience).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), _NOW);
		expect(f.facts.requireCurrentReader).not.toHaveBeenCalled();
	});

	it("reads retired history through the caller-only reader gate and preserves former audience labels", async function _RetiredReader()
	{
		const f = _Repository({ current: _Current({ status: AgentRoutineStatus.Retired, nextAutomaticOccurrence: null }) });

		await expect(f.repository.read({ caller: _CALLER, routineId: "routine-1" })).resolves.toMatchObject({ status: RoutineStatus.Retired, ownership: "owner", selectedManagedService: { managedServiceId: "service-1", displayName: "Research assistant" }, audienceParticipantRefs: ["member-1", "member-2"], capabilities: { revise: false, pause: false, resume: false, retire: false, runNow: false } });
		expect(f.facts.requireCurrentReader).toHaveBeenCalledWith(_CALLER, expect.any(Object), expect.any(Object), _NOW);
		expect(f.facts.requireCurrentAudience).not.toHaveBeenCalled();
		expect(f.conversations.projectAudience).toHaveBeenCalledOnce();
	});

	it("excludes a caller outside the frozen audience before projection", async function _OutsideAudience()
	{
		const f = _Repository();
		const outsider = { ..._CALLER, principalId: "principal-outside", subjectId: "subject-outside" };

		await expect(f.repository.read({ caller: outsider, routineId: "routine-1" })).resolves.toBeNull();
		expect(f.facts.requireCurrentAudience).not.toHaveBeenCalled();
		expect(f.conversations.projectAudience).not.toHaveBeenCalled();
	});

	it("denies direct firing history to a non-audience Routine Read principal before querying firings", async function _HistoryOutsideAudience()
	{
		const f = _Repository();
		const outsider = { ..._CALLER, principalId: "principal-outside", subjectId: "subject-outside" };

		await expect(f.repository.firings({ caller: outsider, routineId: "routine-1", limit: 20, after: null })).rejects.toBeInstanceOf(RoutineCommandUnavailableError);
		expect(f.agentRoutineFiring.findMany).not.toHaveBeenCalled();
	});

	it.each([
		"current_authority_or_audience_refused",
		"preparation_current_execution_eligibility_refused",
		"activation_current_execution_eligibility_refused",
		"run_admission_current_authority_refused",
		"stage_preparation_current_authority_refused",
		"stage_activation_current_authority_refused",
		"stage_run_admission_current_authority_refused",
	])("maps the saved current-authority reason %s to the closed public reason", async function _Reason(reason)
	{
		const f = _Repository({ firingRows: [_Refused(reason)] });

		await expect(f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null })).resolves.toMatchObject({ items: [{ reason: RoutineFiringReasons.CurrentAuthorityOrAudienceRefused }] });
	});

	it.each(["toString", "constructor", "unknown_reason"])("rejects unknown or inherited firing reason %s", async function _UnknownReason(reason)
	{
		const f = _Repository({ firingRows: [_Refused(reason)] });

		await expect(f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null })).rejects.toThrow("unknown firing reason");
	});

	it("returns a result conversation only for exact published history, successful run evidence, and current read access", async function _ResultLink()
	{
		const f = _Repository({ firingRows: [_Completed()] });
		f.runHistory.read.mockResolvedValue([{ runId: "run-1", terminalReason: AgentRunTerminalReasons.Success, actualCost: null }]);
		f.conversations.readableConversationIds.mockResolvedValue(["occurrence-1"]);

		await expect(f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null })).resolves.toMatchObject({ items: [{ resultConversationId: "occurrence-1" }] });
		expect(f.conversations.readableConversationIds).toHaveBeenCalledWith(_CALLER, ["occurrence-1"], _NOW);
	});

	it("withholds a valid result link after current occurrence access ends", async function _UnreadableResult()
	{
		const f = _Repository({ firingRows: [_Completed()] });
		f.runHistory.read.mockResolvedValue([{ runId: "run-1", terminalReason: AgentRunTerminalReasons.Success, actualCost: null }]);

		await expect(f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null })).resolves.toMatchObject({ items: [{ resultConversationId: null }] });
	});

	it("returns no result link while the linked run remains nonterminal", async function _NonterminalResult()
	{
		const row = _Completed({ disposition: AgentRoutineFiringDisposition.Running, finishedAt: null, resultReference: null, resultDigest: null });
		const f = _Repository({ firingRows: [row] });
		f.runHistory.read.mockResolvedValue([{ runId: "run-1", terminalReason: null, actualCost: null }]);

		await expect(f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null })).resolves.toMatchObject({ items: [{ resultConversationId: null, runTerminalReason: null }] });
		expect(f.conversations.readableConversationIds).toHaveBeenCalledWith(_CALLER, [], _NOW);
	});

	it.each([
		["unsuccessful run", _Completed(), AgentRunTerminalReasons.RuntimeFailure],
		["missing result digest", _Completed({ resultDigest: null }), AgentRunTerminalReasons.Success],
	])("withholds or rejects a result link with %s", async function _InvalidResult(_label, row, terminalReason)
	{
		const f = _Repository({ firingRows: [row] });
		f.runHistory.read.mockResolvedValue([{ runId: "run-1", terminalReason, actualCost: null }]);
		const operation = f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null });
		if (row.resultDigest === null)
			await expect(operation).rejects.toThrow("inconsistent firing evidence");
		else
			await expect(operation).resolves.toMatchObject({ items: [{ resultConversationId: null }] });
	});

	it.each([
		["mismatched reference", { receiptId: "preparation-1", historyReference: "routine-occurrence-instruction-other", digest: `sha256:${"a".repeat(64)}` }],
		["malformed receipt", { historyReference: "routine-occurrence-instruction-occurrence-1" }],
	])("rejects %s before exposing a result link", async function _InvalidPreparation(_label, preparationReceipt)
	{
		const f = _Repository({ firingRows: [_Completed({ preparationReceipt })] });
		f.runHistory.read.mockResolvedValue([{ runId: "run-1", terminalReason: AgentRunTerminalReasons.Success, actualCost: null }]);

		await expect(f.repository.firings({ caller: _CALLER, routineId: "routine-1", limit: 20, after: null })).rejects.toThrow();
	});

	it("reuses managed-service reads once per distinct service in one list snapshot", async function _ServiceCache()
	{
		const f = _Repository();
		const candidates = Array.from({ length: 3 }, function _Candidate(_value, index) { return { id: `routine-${index}`, createdAt: new Date(`2026-09-25T12:0${index}:00.000Z`) }; });
		const current = _Current();
		f.routineFindMany.mockResolvedValue(candidates);
		f.facts.current.mockImplementation(async function _CurrentForList(_siloId: string, routineId: string) { return _Current({ ...current.routine, id: routineId }, { ...current.revision, routineId }); });

		await f.repository.list({ caller: _CALLER, limit: 3, after: null });
		expect(f.managedServices.list).toHaveBeenCalledOnce();
		expect(f.managedServices.eligible).toHaveBeenCalledOnce();
	});
});
