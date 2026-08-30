import { describe, expect, it, vi } from "vitest";

import { DefaultProviderEffectCommandExecutor, _ProviderKeyMaterialVerifier } from "../provider-effect-command-executor";
import { DefaultProviderEffectCommandHandler } from "../provider-effect-command-handler";
import { ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type ProviderEffectCommandHandler, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectCommandUnitOfWork, type ProviderEffectExecutionContext } from "../provider-effect-command.types";

/** Trusted route coordinates shared by executor tests. */
const _CONTEXT: ProviderEffectExecutionContext = { siloId: "acme", principalId: "principal-1", resourceKind: "provider-connection", resourceId: "byok:openai", executorProfile: "opencrane-control-plane/provider-effect-v1" };

/** Build one claimed Set-BYOK command without placing raw material in the record. */
function _command(): ProviderEffectCommandRecord
{
	return { id: "command-1", siloId: "acme", principalId: "principal-1", payload: { kind: ProviderEffectCommandKinds.SetByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } }, resourceKind: "provider-connection", resourceId: "byok:openai", resourceRevision: "revision-1", argumentsDigest: "sha256:arguments", materialVerifier: _ProviderKeyMaterialVerifier("command-1", "openai", "sk-test"), authorization: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" }, approvalId: null, executorProfile: _CONTEXT.executorProfile, materialRequirement: ProviderEffectMaterialRequirements.EphemeralProviderKey, state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-1", claimExpiresAt: new Date("2099-01-01T00:00:00.000Z") };
}

/** Build a UnitOfWork that forwards every transaction callback to one fake repository. */
function _unitOfWork(repository: ProviderEffectCommandRepository): ProviderEffectCommandUnitOfWork
{
	return { run: async function _Run<Result>(operation: (value: ProviderEffectCommandRepository) => Promise<Result>): Promise<Result> { return operation(repository); } };
}

describe("DefaultProviderEffectCommandExecutor", function _Suite()
{
	it("performs the external effect only after the claim operation returns", async function _PostCommitOrdering()
	{
		const order: string[] = [];
		const command = _command();
		const repository = { claim: vi.fn(async function _Claim() { order.push("claim-committed"); return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), complete: vi.fn(async function _Complete() { order.push("result-committed"); return true; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { order.push("external-effect"); return { kind: ProviderEffectCommandKinds.SetByokKey, providerCredentialId: "credential-1", litellmRegistered: true } as const; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler);

		const result = await executor.execute(command.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT);

		expect(result.status).toBe(ProviderEffectExecutionStatuses.Succeeded);
		expect(order).toEqual(["claim-committed", "external-effect", "result-committed"]);
	});

	it("does not call an external adapter when claim admission rolls back", async function _RollbackStopsEffect()
	{
		const repository = { claim: vi.fn(async function _Claim() { throw new Error("transaction rolled back"); }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler);

		await expect(executor.execute("command-1", { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).rejects.toThrow("rolled back");
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("keeps a raw-key command awaiting material without calling the handler", async function _RequiresMaterial()
	{
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.AwaitingMaterial, command: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler);

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
			claim: vi.fn(async function _Claim(_id, _verifier, context) { expect(context).toEqual(_CONTEXT); return { status: ProviderEffectExecutionStatuses.Claimed, command }; }),
			complete: vi.fn(async function _Complete() { return true; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { return { kind: ProviderEffectCommandKinds.DeleteByokKey } as const; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).toHaveBeenCalledOnce();
	});

	it("does not call an external adapter after the delivery budget is exhausted", async function _HonoursBoundedDelivery()
	{
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Failed, command: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler);

		await expect(executor.execute("command-1", undefined, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Failed, result: null });
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("rejects persisted custody coordinates outside the fixed provider catalogue", async function _ValidatesCustodyCoordinates()
	{
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "attacker-secret", litellmCredentialName: "byok-openai" } } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const handler = new DefaultProviderEffectCommandHandler({} as never, {} as never, "opencrane-system");

		await expect(handler.execute(command, {})).rejects.toThrow("invalid custody coordinates");
	});
});
