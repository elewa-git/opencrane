import { afterEach, describe, expect, it, vi } from "vitest";

import { _OutputRecoveryHarness } from "./conversation-output-recovery.fixture";

/** Pause exactly the winning gateway request so another process can observe its reservation. */
function _Gate()
{
	let release!: () => void;
	const promise = new Promise<void>(resolve => { release = resolve; });
	return { promise, release };
}

describe("one server-owned model request across process restarts", function _Suite()
{
	afterEach(function _RestoreClock() { vi.restoreAllMocks(); });

	it("returns no key or prompt from workflow start and persists a single reserved answer", async function _Answer()
	{
		const f = await _OutputRecoveryHarness(false);
		expect(await f.restart().start(f.workflowCommand)).toMatchObject({ bootstrapId: f.output.bootstrapId });
		expect(f.credentials.issueOnce).not.toHaveBeenCalled();
		expect(await f.authority.advance(f.output.bootstrapId)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		const turn = (await f.store.load(f.output.bootstrapId))!;
		expect(turn.modelReservation).toMatchObject({ ordinal: 1, maxCompletionTokens: 100, compiledInputDigest: turn.compile.digest });
		expect(turn.outputReceipt?.event.id).toBe(turn.modelReservation?.invocationFence);
		expect(f.history.streams.get(`conversation-computer-turn-${turn.bootstrapId}`)).toHaveLength(3);
		expect(JSON.stringify(f.history.streams.get(`conversation-computer-turn-${turn.bootstrapId}`)!.map(event => event.data))).not.toMatch(/test-only-key|A private chosen answer|instructions/);
		expect(await f.restart().advance(f.output.bootstrapId)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.history.streams.get(f.stream)!.slice(2)).toHaveLength(1);
	});

	it("lets only the live winning handler send while concurrent and restarted handlers report pending", async function _Concurrent()
	{
		const f = await _OutputRecoveryHarness(false);
		const entered = _Gate();
		const proceed = _Gate();
		f.model.request.mockImplementationOnce(async function _HeldRequest() { entered.release(); await proceed.promise; return { kind: "text", text: "A private chosen answer" }; });
		const first = f.authority.advance(f.output.bootstrapId);
		await entered.promise;
		expect(await f.restart().advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect(await f.restart().start(f.workflowCommand)).toMatchObject({ bootstrapId: f.output.bootstrapId });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.model.request).toHaveBeenCalledOnce();
		proceed.release();
		expect(await first).toEqual({ outcome: "completed" });
	});

	it("does not adopt a reservation after append response loss, even though no gateway request began", async function _ReservationResponseLoss()
	{
		const f = await _OutputRecoveryHarness(false);
		f.history.afterAppend = async command =>
		{
			if (command.events[0].type.endsWith("model-reserved.v1"))
				throw new Error("reservation response lost");
		};
		expect(await f.authority.advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect(await f.restart().advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect(f.credentials.issueOnce).not.toHaveBeenCalled();
		expect(f.model.request).not.toHaveBeenCalled();
		const reservation = (await f.store.load(f.output.bootstrapId))!.modelReservation!;
		vi.spyOn(Date, "now").mockReturnValue(reservation.dispatchDeadlineEpochMs + 1);
		expect(await f.restart().start(f.workflowCommand)).toMatchObject({ bootstrapId: f.output.bootstrapId });
		expect(await f.restart().advance(f.output.bootstrapId)).toEqual({ outcome: "response_unavailable" });
		expect((await f.store.load(f.output.bootstrapId))!.modelReservation).toEqual(reservation);
	});

	it("never renews a paid allowance after an uncertain gateway response", async function _GatewayResponseLoss()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockRejectedValueOnce(new Error("sanitized transport failure"));
		expect(await f.authority.advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		const reservation = (await f.store.load(f.output.bootstrapId))!.modelReservation!;
		vi.spyOn(Date, "now").mockReturnValue(reservation.dispatchDeadlineEpochMs + 1);
		for (let retry = 0; retry < 3; retry++)
			expect(await f.restart().advance(f.output.bootstrapId)).toEqual({ outcome: "response_unavailable" });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.outputPayloads.store).not.toHaveBeenCalled();
		expect(await f.store.loadActive({ siloId: "silo-1", ...f.command })).not.toBeNull();
	});

	it("finishes a saved answer before recompiling an already advanced conversation head", async function _SavedAnswer()
	{
		const f = await _OutputRecoveryHarness(false);
		f.runLifecycle.complete.mockRejectedValueOnce(new Error("completion unavailable"));
		expect(await f.authority.advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect((await f.store.load(f.output.bootstrapId))!.outputReceipt).not.toBeNull();
		f.flags.mayAppend = false;
		expect(await f.restart().start(f.workflowCommand)).toBeNull();
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.history.streams.get(f.stream)!.slice(2)).toHaveLength(1);
	});

	it("passes a shorter post-key lease deadline to the request without renewing the reservation", async function _ShorterCurrentLease()
	{
		const f = await _OutputRecoveryHarness(false);
		const shorter = Date.now() + 5_000;
		f.credentials.issueOnce.mockImplementationOnce(async function _LeaseShortenedDuringKeyIssue()
		{
			f.current.lease.expiresAt = new Date(shorter).toISOString();
			return { key: "test-only-key", credentialDigest: `sha256:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" };
		});
		expect(await f.authority.advance(f.output.bootstrapId)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledWith(expect.objectContaining({ notAfterEpochMs: shorter }));
		expect((await f.store.load(f.output.bootstrapId))!.modelReservation!.dispatchDeadlineEpochMs).toBeGreaterThan(shorter);
	});

	it("keeps the shorter dispatch bound after later authority renewal and a slow payload write", async function _NoRenewedOutputDeadline()
	{
		const f = await _OutputRecoveryHarness(false);
		const shorter = Date.now() + 5_000;
		f.credentials.issueOnce.mockImplementationOnce(async function _Shorten()
		{
			f.current.lease.expiresAt = new Date(shorter).toISOString();
			return { key: "test-only-key", credentialDigest: `sha256:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" };
		});
		const persist = f.outputPayloads.store.getMockImplementation()!;
		f.outputPayloads.store.mockImplementationOnce(async function _SlowPayload(...args)
		{
			const result = await persist(...args);
			f.current.lease.expiresAt = "2099-01-01T00:00:00.000Z";
			vi.spyOn(Date, "now").mockReturnValue(shorter + 1);
			return result;
		});
		expect(await f.authority.advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect((await f.store.load(f.output.bootstrapId))!.outputReceipt).toBeNull();
		expect(f.history.streams.get(f.stream)!.slice(2)).toHaveLength(0);
	});

	it("withholds a response that arrives after its fixed dispatch deadline", async function _LateResponse()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(async function _LateGateway()
		{
			const reservation = (await f.store.load(f.output.bootstrapId))!.modelReservation!;
			vi.spyOn(Date, "now").mockReturnValue(reservation.dispatchDeadlineEpochMs + 1);
			return { kind: "text", text: "A private chosen answer" };
		});
		expect(await f.authority.advance(f.output.bootstrapId)).toEqual({ outcome: "response_unavailable" });
		expect((await f.store.load(f.output.bootstrapId))!.outputReceipt).toBeNull();
		expect(f.history.streams.get(f.stream)!.slice(2)).toHaveLength(0);
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
	});

	it("rechecks the original history after the gateway responds before publishing its answer", async function _ForeignHistory()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(async function _ChangedHistory() { f.flags.mayAppend = false; return { kind: "text", text: "A private chosen answer" }; });
		expect(await f.authority.advance(f.output.bootstrapId)).toMatchObject({ outcome: "model_pending" });
		expect(f.outputPayloads.store).not.toHaveBeenCalled();
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		expect(f.model.request).toHaveBeenCalledOnce();
	});

	it.each(["zero-calls", "zero-tokens", "negative-route", "no-ceiling", "expired"])("refuses invalid frozen allowances before reservation or key issuance: %s", async function _InvalidBudget(kind)
	{
		const f = await _OutputRecoveryHarness(false);
		const candidate = (await f.compiler.compile())!;
		const input = candidate.compiledInput;
		const budget = { ...input.budget };
		const model = { ...input.model };
		if (kind === "zero-calls")
			budget.maxModelTurns = 0;
		if (kind === "zero-tokens")
			budget.maxCompletionTokens = 0;
		if (kind === "negative-route")
			model.maxOutputTokens = -1;
		if (kind === "no-ceiling")
		{
			budget.maxCompletionTokens = null;
			model.maxOutputTokens = null;
		}
		if (kind === "expired")
			budget.wallClockDeadlineEpochMs = Date.now() - 1;
		f.compiler.compile.mockResolvedValue({ ...candidate, compiledInput: { ...input, model, budget } });
		expect(await f.authority.advance(f.output.bootstrapId)).toEqual({ outcome: "retry" });
		expect((await f.store.load(f.output.bootstrapId))!.modelReservation).toBeNull();
		expect(f.credentials.issueOnce).not.toHaveBeenCalled();
		expect(f.model.request).not.toHaveBeenCalled();
	});

	it("requires the current server-resolved Pod even for an already reserved request", async function _WrongPod()
	{
		const f = await _OutputRecoveryHarness();
		f.pods.resolve.mockResolvedValueOnce(null);
		await expect(f.restart().advance(f.output.bootstrapId)).rejects.toThrow("lease-bound");
		expect(f.model.request).not.toHaveBeenCalled();
		expect(f.credentials.issueOnce).not.toHaveBeenCalled();
	});

	it.each(["fence", "request", "tokens", "metadata", "event-id", "extra-field", "budget-drift", "deadline-renewal", "request-drift"])("rejects a corrupted saved reservation before gateway use: %s", async function _CorruptReservation(kind)
	{
		const f = await _OutputRecoveryHarness();
		const event = f.history.streams.get(`conversation-computer-turn-${f.output.bootstrapId}`)![1];
		const reservation = event.data["reservation"] as Record<string, unknown>;
		if (kind === "fence")
			reservation["invocationFence"] = "invalid";
		if (kind === "request")
			reservation["requestDigest"] = "invalid";
		if (kind === "tokens")
			reservation["maxCompletionTokens"] = 0;
		if (kind === "metadata")
			event.metadata["computerId"] = "another-computer";
		if (kind === "event-id")
			f.history.streams.get(`conversation-computer-turn-${f.output.bootstrapId}`)![1] = { ...event, id: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
		if (kind === "extra-field")
			reservation["key"] = "forged-secret";
		if (kind === "budget-drift")
			reservation["maxCompletionTokens"] = 101;
		if (kind === "deadline-renewal")
			reservation["authorityExpiresAtEpochMs"] = Number(reservation["authorityExpiresAtEpochMs"]) + 1;
		if (kind === "request-drift")
			reservation["requestDigest"] = `sha256:${"c".repeat(64)}`;
		await expect(f.restart().advance(f.output.bootstrapId)).rejects.toThrow("reservation");
		expect(f.model.request).not.toHaveBeenCalled();
	});
});
