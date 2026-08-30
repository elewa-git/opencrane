import { describe, expect, it, vi } from "vitest";

const _TELEMETRY = vi.hoisted(function _Telemetry()
{
	return { traceThrown: [] as unknown[], error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

vi.mock("@opencrane/backend/observability", async function _Observability(importOriginal: () => Promise<typeof import("@opencrane/backend/observability")>)
{
	return {
		...await importOriginal(),
		___DoWithTrace: async function _Trace<Result>(_name: string, _fields: Readonly<Record<string, unknown>>, operation: () => Promise<Result>): Promise<Result>
		{
			try
			{
				return await operation();
			}
			catch (error)
			{
				_TELEMETRY.traceThrown.push(error);
				throw error;
			}
		},
		___MarkActiveSpanFailed: vi.fn(),
	};
});

vi.mock("../log", function _Log()
{
	return { _log: { error: _TELEMETRY.error, warn: _TELEMETRY.warn, info: _TELEMETRY.info, debug: _TELEMETRY.debug } };
});

import { DefaultProviderEffectCommandExecutor, _ProviderKeyMaterialVerifier } from "../provider-effect-command-executor";
import { DefaultProviderEffectCommandHandler } from "../provider-effect-command-handler";
import { ProviderEffectOutcomeUncertainError, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE } from "../provider-effect-command-errors";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProviderEffectAdmissionStatuses, ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type ProviderEffectCommandHandler, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectCommandUnitOfWork, type ProviderEffectExecutionContext } from "../provider-effect-command.types";

/** Trusted route coordinates shared by executor tests. */
const _CONTEXT: ProviderEffectExecutionContext = { siloId: "acme", principalId: "principal-1", actorKind: "user", actorId: "principal-1", resourceKind: "provider-connection", resourceId: "byok:openai", executorProfile: "opencrane-control-plane/provider-effect-v1" };

/** Build one claimed Set-BYOK command without placing raw material in the record. */
function _command(): ProviderEffectCommandRecord
{
	return { id: "command-1", siloId: "acme", principalId: "principal-1", payload: { kind: ProviderEffectCommandKinds.SetByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } }, resourceKind: "provider-connection", resourceId: "byok:openai", resourceRevision: "revision-1", desiredGeneration: 1, argumentsDigest: "sha256:arguments", materialVerifier: _ProviderKeyMaterialVerifier("command-1", "openai", "sk-test"), authorization: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" }, approvalId: null, executorProfile: _CONTEXT.executorProfile, materialRequirement: ProviderEffectMaterialRequirements.EphemeralProviderKey, state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-1", claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"), failureCode: null };
}

/** Build a UnitOfWork that forwards every transaction callback to one fake repository. */
function _unitOfWork(repository: ProviderEffectCommandRepository): ProviderEffectCommandUnitOfWork
{
	return { run: async function _Run<Result>(operation: (value: ProviderEffectCommandRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result> { return operation(repository, {} as AuthorizationAuthority); } };
}

describe("DefaultProviderEffectCommandExecutor", function _Suite()
{
	it("performs the external effect only after the claim operation returns", async function _PostCommitOrdering()
	{
		const order: string[] = [];
		const command = _command();
		const repository = { claim: vi.fn(async function _Claim() { order.push("claim-committed"); return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), preflight: vi.fn(async function _Preflight() { order.push("preflight-committed"); return true; }), complete: vi.fn(async function _Complete() { order.push("result-committed"); return ProviderEffectExecutionStatuses.Succeeded; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { order.push("external-effect"); return { kind: ProviderEffectCommandKinds.SetByokKey, providerCredentialId: "credential-1", litellmRegistered: true } as const; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		const result = await executor.execute(command.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT);

		expect(result.status).toBe(ProviderEffectExecutionStatuses.Succeeded);
		expect(order).toEqual(["claim-committed", "preflight-committed", "external-effect", "result-committed"]);
	});

	it("does not call an external adapter when claim admission rolls back", async function _RollbackStopsEffect()
	{
		const repository = { claim: vi.fn(async function _Claim() { throw new Error("transaction rolled back"); }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.execute("command-1", { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).rejects.toThrow("rolled back");
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("keeps a raw-key command awaiting material without calling the handler", async function _RequiresMaterial()
	{
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.AwaitingMaterial, command: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		const result = await executor.execute("command-1", undefined, _CONTEXT);

		expect(result.status).toBe(ProviderEffectExecutionStatuses.AwaitingMaterial);
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("salts raw-key verifiers per command and never returns the key", function _VerifierIsCommandBound()
	{
		const first = _ProviderKeyMaterialVerifier("command-1", "openai", "sk-same");
		const second = _ProviderKeyMaterialVerifier("command-2", "openai", "sk-same");

		expect(first).not.toBe(second);
		expect(first).not.toContain("sk-same");
		expect(second).not.toContain("sk-same");
	});

	it("resumes one database-complete command from its persisted execution context", async function _ReconcilesPersistedContext()
	{
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const repository = {
			nextRecoverable: vi.fn(async function _Next() { return command; }),
			claim: vi.fn(async function _Claim(_id, _verifier, context) { expect(context).toEqual({ ..._CONTEXT, actorKind: "system", actorId: _CONTEXT.executorProfile }); return { status: ProviderEffectExecutionStatuses.Claimed, command }; }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			complete: vi.fn(async function _Complete() { return ProviderEffectExecutionStatuses.Succeeded; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { return { kind: ProviderEffectCommandKinds.DeleteByokKey } as const; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).toHaveBeenCalledOnce();
	});

	it("refuses reconciliation when a saved command names a different executor profile", async function _RejectsSavedProfile()
	{
		const command = { ..._command(), executorProfile: "untrusted/provider-effect-v1", payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const repository = {
			nextRecoverable: vi.fn(async function _Next() { return command; }),
			claim: vi.fn(async function _Claim(_id, _verifier, context)
			{
				expect(context).toEqual({ ..._CONTEXT, actorKind: "system", actorId: _CONTEXT.executorProfile });
				return { status: ProviderEffectExecutionStatuses.Failed, command: null };
			}),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("does not call an external adapter after the delivery budget is exhausted", async function _HonoursBoundedDelivery()
	{
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Failed, command: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.execute("command-1", undefined, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Failed, result: null });
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("does not resume external I/O after current authority is revoked", async function _RevokedResume()
	{
		const command = _command();
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), preflight: vi.fn(async function _Preflight() { return false; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.execute(command.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Failed, result: null });
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("does not reconcile external I/O after current authority is revoked", async function _RevokedReconcile()
	{
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const repository = { nextRecoverable: vi.fn(async function _Next() { return command; }), claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), preflight: vi.fn(async function _Preflight() { return false; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("rejects persisted custody coordinates outside the fixed provider catalogue", async function _ValidatesCustodyCoordinates()
	{
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "attacker-secret", litellmCredentialName: "byok-openai" } } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const handler = new DefaultProviderEffectCommandHandler({} as never, {} as never, "opencrane-system");

		await expect(handler.execute(command, {})).rejects.toThrow("invalid custody coordinates");
	});

	it("keeps raw adapter errors outside trace and log boundaries", async function _RedactsRawFailure()
	{
		_TELEMETRY.traceThrown.length = 0;
		_TELEMETRY.warn.mockClear();
		const command = _command();
		const repository = {
			claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			fail: vi.fn(async function _Fail() { return ProviderEffectExecutionStatuses.AwaitingMaterial; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { throw new Error("raw Secret body contains sk-provider-material"); }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);

		await expect(executor.execute(command.id, { provider: "openai", providerKey: "sk-provider-material" }, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.AwaitingMaterial, result: null });
		expect(_TELEMETRY.traceThrown).toEqual([]);
		expect(JSON.stringify(_TELEMETRY.warn.mock.calls)).not.toContain("sk-provider-material");
		expect(_TELEMETRY.warn).toHaveBeenCalledWith(expect.objectContaining({ err: { type: "Error" } }), "provider effect delivery failed and remains recoverable");
	});

	it.each([ProviderEffectCommandKinds.SetByokKey, ProviderEffectCommandKinds.DeleteByokKey])("keeps generation B blocked until uncertain %s generation A positively converges", async function _UncertainBarrier(kind)
	{
		let barrier = true;
		let releaseUncertain: (() => void) | null = null;
		const payload = kind === ProviderEffectCommandKinds.SetByokKey
			? { kind, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const
			: { kind, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const;
		const first = { ..._command(), payload, materialRequirement: kind === ProviderEffectCommandKinds.SetByokKey ? ProviderEffectMaterialRequirements.EphemeralProviderKey : ProviderEffectMaterialRequirements.None };
		const retry = { ...first, deliveryCount: 4, claimFence: "fence-retry", failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE };
		const repository = {
			claim: vi.fn()
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Claimed, command: first })
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Claimed, command: retry }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			retainClaim: vi.fn(async function _Retain() { barrier = true; return ProviderEffectExecutionStatuses.Retryable; }),
			complete: vi.fn(async function _Complete() { barrier = false; return ProviderEffectExecutionStatuses.Succeeded; }),
			fail: vi.fn(),
			admit: vi.fn(async function _Admit()
			{
				return barrier
					? { status: ProviderEffectAdmissionStatuses.Busy, command: null, blocker: { commandId: first.id, state: ProviderEffectCommandStates.Claimed } }
					: { status: ProviderEffectAdmissionStatuses.Admitted, command: retry, blocker: null };
			}),
		} as unknown as ProviderEffectCommandRepository;
		const uncertainDelivery = new Promise<never>(function _Delayed(_resolve, reject) { releaseUncertain = function _Release() { reject(new ProviderEffectOutcomeUncertainError()); }; });
		const successfulResult = kind === ProviderEffectCommandKinds.SetByokKey
			? { kind, providerCredentialId: "credential-1", litellmRegistered: true } as const
			: { kind } as const;
		const handler = { execute: vi.fn().mockReturnValueOnce(uncertainDelivery).mockResolvedValueOnce(successfulResult) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile);
		const material = kind === ProviderEffectCommandKinds.SetByokKey ? { provider: "openai", providerKey: "sk-test" } : undefined;

		const delayed = executor.execute(first.id, material, _CONTEXT);
		await vi.waitFor(function _DeliveryStarted() { expect(handler.execute).toHaveBeenCalledOnce(); });
		await expect(repository.admit({} as never)).resolves.toMatchObject({ status: ProviderEffectAdmissionStatuses.Busy });
		releaseUncertain!();
		await expect(delayed).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Retryable, result: null });
		await expect(repository.admit({} as never)).resolves.toMatchObject({ status: ProviderEffectAdmissionStatuses.Busy });
		await expect(executor.execute(first.id, material, _CONTEXT)).resolves.toMatchObject({ status: ProviderEffectExecutionStatuses.Succeeded });
		await expect(repository.admit({} as never)).resolves.toMatchObject({ status: ProviderEffectAdmissionStatuses.Admitted });
		expect(repository.fail).not.toHaveBeenCalled();
		expect(repository.retainClaim).toHaveBeenCalledWith(first, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE);
	});
});
