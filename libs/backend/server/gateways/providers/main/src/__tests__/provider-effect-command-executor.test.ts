import { afterEach, describe, expect, it, vi } from "vitest";

const _TELEMETRY = vi.hoisted(function _Telemetry()
{
	return { traceNames: [] as string[], traceThrown: [] as unknown[], markActiveSpanFailed: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

vi.mock("@opencrane/backend/observability", async function _Observability(importOriginal: () => Promise<typeof import("@opencrane/backend/observability")>)
{
	return {
		...await importOriginal(),
			___DoWithTrace: async function _Trace<Result>(name: string, _fields: Readonly<Record<string, unknown>>, operation: () => Promise<Result>): Promise<Result>
			{
				_TELEMETRY.traceNames.push(name);
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
			___MarkActiveSpanFailed: _TELEMETRY.markActiveSpanFailed,
	};
});

vi.mock("../log", function _Log()
{
	return { _log: { error: _TELEMETRY.error, warn: _TELEMETRY.warn, info: _TELEMETRY.info, debug: _TELEMETRY.debug } };
});

import { DefaultProviderEffectCommandExecutor, _ProviderKeyMaterialVerifier } from "../provider-effect-command-executor";
import { DefaultProviderEffectCommandHandler } from "../provider-effect-command-handler";
import { ProviderEffectFinalizationBlockedError, ProviderEffectOutcomeUncertainError, _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE } from "../provider-effect-command-errors";
import type { Logger } from "@opencrane/backend/observability";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";
import { ProviderEffectAdmissionStatuses, ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type DeleteByokKeyEffectPayload, type ProviderEffectCommandHandler, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectCommandUnitOfWork, type ProviderEffectExecutionContext } from "../provider-effect-command.types";

/** Trusted route coordinates shared by executor tests. */
const _CONTEXT: ProviderEffectExecutionContext = { siloId: "acme", principalId: "principal-1", actorKind: "user", actorId: "principal-1", resourceKind: "provider-connection", resourceId: "byok:acme:openai", executorProfile: "opencrane-control-plane/provider-effect-v1" };

/** Process logger used by the executor and handler under test. */
const _LOGGER = _TELEMETRY as unknown as Logger;

/** Build one claimed Set-BYOK command without placing raw material in the record. */
function _command(): ProviderEffectCommandRecord
{
	return { id: "command-1", siloId: "acme", principalId: "principal-1", payload: { kind: ProviderEffectCommandKinds.SetByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } }, resourceKind: "provider-connection", resourceId: "byok:acme:openai", resourceRevision: "revision-1", desiredGeneration: 1, argumentsDigest: "sha256:arguments", materialVerifier: _ProviderKeyMaterialVerifier("command-1", "openai", "sk-test"), authorization: { decisionDigest: "sha256:decision", policyRevisionHash: "sha256:policy", effectiveAuthorizationDigest: "sha256:effective" }, executorProfile: _CONTEXT.executorProfile, materialRequirement: ProviderEffectMaterialRequirements.EphemeralProviderKey, state: ProviderEffectCommandStates.Claimed, deliveryCount: 1, claimFence: "fence-1", claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"), failureCode: null, followUpCommandId: null, result: null };
}

/** Builds a Delete-BYOK payload without a live LiteLLM registration. */
function _deletePayload(secretRef = "byok-provider-key-openai"): DeleteByokKeyEffectPayload
{
	return { provider: "openai", secretRef, litellmCredentialName: "byok-openai", litellmRegistered: false, modelDefinitionIds: [], deployments: [] };
}

/** Build a UnitOfWork that forwards every transaction callback to one fake repository. */
function _unitOfWork(repository: ProviderEffectCommandRepository): ProviderEffectCommandUnitOfWork
{
	return { run: async function _Run<Result>(operation: (value: ProviderEffectCommandRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result> { return operation(repository, {} as AuthorizationAuthority); } };
}

describe("DefaultProviderEffectCommandExecutor", function _Suite()
{
	afterEach(function _RestoreEnvironment()
	{
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("performs the external effect only after the claim operation returns", async function _PostCommitOrdering()
	{
		const order: string[] = [];
		const command = _command();
		const repository = { claim: vi.fn(async function _Claim() { order.push("claim-committed"); return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), preflight: vi.fn(async function _Preflight() { order.push("preflight-committed"); return true; }), complete: vi.fn(async function _Complete() { order.push("result-committed"); return { status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { order.push("external-effect"); return { kind: ProviderEffectCommandKinds.SetByokKey, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", models: [], embedding: { status: ProviderEmbeddingReconciliationStatuses.NotApplicable, deployments: [] } } as const; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		const result = await executor.execute(command.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT);

		expect(result.status).toBe(ProviderEffectExecutionStatuses.Succeeded);
		expect(order).toEqual(["claim-committed", "preflight-committed", "external-effect", "result-committed"]);
	});

	it("does not call an external adapter when claim admission rolls back", async function _RollbackStopsEffect()
	{
		const repository = { claim: vi.fn(async function _Claim() { throw new Error("transaction rolled back"); }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.execute("command-1", { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).rejects.toThrow("rolled back");
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("keeps a raw-key command awaiting material without calling the handler", async function _RequiresMaterial()
	{
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.AwaitingMaterial, command: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

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
		_TELEMETRY.traceNames.length = 0;
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: _deletePayload() } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const repository = {
			nextRecoverable: vi.fn(async function _Next() { return command; }),
			claim: vi.fn(async function _Claim(_id, _verifier, context) { expect(context).toEqual({ ..._CONTEXT, actorKind: "system", actorId: _CONTEXT.executorProfile }); return { status: ProviderEffectExecutionStatuses.Claimed, command }; }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			complete: vi.fn(async function _Complete() { return { status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand: null }; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { return { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "openai" } as const; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).toHaveBeenCalledOnce();
		expect(_TELEMETRY.traceNames).toContain("provider.effect.reconcile.discover");
	});

	it("finalizes recovered evidence without repeating external I/O", async function _FinalizesRecoveredEvidence()
	{
		const savedResult = { kind: ProviderEffectCommandKinds.DeleteByokKey, provider: "openai" } as const;
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: _deletePayload() } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None, deliveryCount: 3, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: savedResult };
		const repository = {
			nextRecoverable: vi.fn(async function _Next() { return command; }),
			claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }),
			preflight: vi.fn(),
			complete: vi.fn(async function _Complete(_command, result) { expect(result).toBe(savedResult); return { status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand: null }; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.reconcileNext()).resolves.toBe(true);

		expect(repository.preflight).not.toHaveBeenCalled();
		expect(handler.execute).not.toHaveBeenCalled();
		expect(repository.complete).toHaveBeenCalledOnce();
	});

	it("saves a rolled-back alias result and finalizes it without repeating provider I/O", async function _RecoversAliasPlanningDenial()
	{
		const result = { kind: ProviderEffectCommandKinds.SetByokKey, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", models: [], embedding: { status: ProviderEmbeddingReconciliationStatuses.NotApplicable, deployments: [] } } as const;
		const initial = _command();
		const recovered = { ...initial, deliveryCount: 1, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result };
		const repository = {
			claim: vi.fn()
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Claimed, command: initial })
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Claimed, command: recovered }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			complete: vi.fn()
				.mockRejectedValueOnce(new ProviderEffectFinalizationBlockedError())
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand: null }),
			blockFinalization: vi.fn(async function _Block() { return ProviderEffectExecutionStatuses.Busy; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { return result; }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.execute(initial.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Busy, result: null });
		await expect(executor.execute(initial.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Succeeded, result });

		expect(handler.execute).toHaveBeenCalledOnce();
		expect(repository.blockFinalization).toHaveBeenCalledWith(initial, result);
		expect(repository.preflight).toHaveBeenCalledOnce();
	});

	it("refuses reconciliation when a saved command names a different executor profile", async function _RejectsSavedProfile()
	{
		const command = { ..._command(), executorProfile: "untrusted/provider-effect-v1", payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: _deletePayload() } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const repository = {
			nextRecoverable: vi.fn(async function _Next() { return command; }),
			claim: vi.fn(async function _Claim(_id, _verifier, context)
			{
				expect(context).toEqual({ ..._CONTEXT, actorKind: "system", actorId: _CONTEXT.executorProfile });
				return { status: ProviderEffectExecutionStatuses.Failed, command: null };
			}),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("does not call an external adapter after the delivery budget is exhausted", async function _HonoursBoundedDelivery()
	{
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Failed, command: null }; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.execute("command-1", undefined, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Failed, result: null });
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("does not resume external I/O after current authority is revoked", async function _RevokedResume()
	{
		_TELEMETRY.markActiveSpanFailed.mockClear();
		const command = _command();
		const repository = { claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), preflight: vi.fn(async function _Preflight() { return false; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.execute(command.id, { provider: "openai", providerKey: "sk-test" }, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Failed, result: null });
		expect(handler.execute).not.toHaveBeenCalled();
		expect(_TELEMETRY.markActiveSpanFailed).toHaveBeenCalledOnce();
	});

	it("does not reconcile external I/O after current authority is revoked", async function _RevokedReconcile()
	{
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: _deletePayload() } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const repository = { nextRecoverable: vi.fn(async function _Next() { return command; }), claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }), preflight: vi.fn(async function _Preflight() { return false; }) } as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn() } as unknown as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.reconcileNext()).resolves.toBe(true);
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it("rejects persisted custody coordinates outside the fixed provider catalogue", async function _ValidatesCustodyCoordinates()
	{
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: _deletePayload("attacker-secret") } as const, materialVerifier: null, materialRequirement: ProviderEffectMaterialRequirements.None };
		const handler = new DefaultProviderEffectCommandHandler({} as never, "opencrane-system", _LOGGER);

		await expect(handler.execute(command, {})).rejects.toThrow("invalid custody coordinates");
	});

	it("returns a secret-free provider catalogue projection without writing product rows", async function _ProjectsProviderCatalogue()
	{
		_TELEMETRY.traceNames.length = 0;
		vi.stubEnv("LITELLM_ENDPOINT", "");
		vi.stubEnv("LITELLM_MASTER_KEY", "");
		const replaceNamespacedSecret = vi.fn(async function _Replace() { return {}; });
		const coreApi = {
			readNamespacedSecret: vi.fn(async function _Read() { return { metadata: { name: "byok-provider-key-openai", resourceVersion: "1" } }; }),
			replaceNamespacedSecret,
		} as never;
		const handler = new DefaultProviderEffectCommandHandler(coreApi, "opencrane-system", _LOGGER);

		const result = await handler.execute(_command(), { provider: "openai", providerKey: "sk-test" });

		expect(result).toMatchObject({ kind: ProviderEffectCommandKinds.SetByokKey, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: null });
		if (result.kind !== ProviderEffectCommandKinds.SetByokKey)
			throw new Error("expected provider catalogue projection");
		expect(result.models.map(function _Name(model) { return model.publicModelName; })).toEqual(["openai/gpt-5.5", "openai/gpt-5.4", "openai/gpt-5.4-nano"]);
		expect(JSON.stringify(result)).not.toContain("sk-test");
		expect(replaceNamespacedSecret).toHaveBeenCalledOnce();
		expect(_TELEMETRY.traceNames).toContain("kubernetes.provider-secret.apply");
		vi.unstubAllEnvs();
	});

	it("converges a second key rotation onto the same catalogue and embedding deployments", async function _StableRotationDeployments()
	{
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm:4000");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		const inventory: Array<Record<string, unknown>> = [];
		const fetchMock = vi.fn(async function _Fetch(url: string, init?: RequestInit): Promise<Response>
		{
			if (url.endsWith("/model/info"))
				return new Response(JSON.stringify({ data: inventory }), { status: 200 });
			if (url.includes("/credentials/"))
				return new Response("", { status: 404 });
			if (url.endsWith("/credentials"))
				return new Response("{}", { status: 200 });
			if (url.endsWith("/model/new"))
			{
				const body = JSON.parse(init?.body as string) as { model_name: string; litellm_params: Record<string, unknown>; model_info?: { id?: string; mode?: string } };
				const id = body.model_info?.id ?? `embedding-${body.model_name}`;
				inventory.push({ model_name: body.model_name, litellm_params: body.litellm_params, model_info: { id, ...(body.model_info?.mode === undefined ? {} : { mode: body.model_info.mode }) } });
				return new Response(JSON.stringify({ model_id: id }), { status: 200 });
			}
			return new Response("not found", { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const coreApi = { readNamespacedSecret: vi.fn(async function _Read() { return { metadata: { name: "byok-provider-key-openai", resourceVersion: "1" } }; }), replaceNamespacedSecret: vi.fn(async function _Replace() { return {}; }) } as never;
		const handler = new DefaultProviderEffectCommandHandler(coreApi, "opencrane-system", _LOGGER);

		const first = await handler.execute({ ..._command(), id: "command-a" }, { provider: "openai", providerKey: "sk-first" });
		const second = await handler.execute({ ..._command(), id: "command-b" }, { provider: "openai", providerKey: "sk-second" });
		if (first.kind !== ProviderEffectCommandKinds.SetByokKey || second.kind !== ProviderEffectCommandKinds.SetByokKey)
			throw new Error("expected two Set-BYOK projections");

		expect(second.models).toEqual(first.models);
		expect(second.embedding).toEqual(first.embedding);
		expect(fetchMock.mock.calls.filter(function _ModelCreates(call) { return (call[0] as string).endsWith("/model/new"); })).toHaveLength(5);
		expect(JSON.stringify([first, second])).not.toMatch(/sk-first|sk-second/);
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("retains the barrier when LiteLLM rejects credential deletion", async function _RejectedDelete()
	{
		_TELEMETRY.traceNames.length = 0;
		_TELEMETRY.markActiveSpanFailed.mockClear();
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm:4000");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rejected", { status: 500 })));
		const coreApi = { readNamespacedSecret: vi.fn(async function _Read() { return { metadata: { resourceVersion: "1" } }; }), replaceNamespacedSecret: vi.fn(async function _Replace() { return {}; }) } as never;
		const handler = new DefaultProviderEffectCommandHandler(coreApi, "opencrane-system", _LOGGER);
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.DeleteByokKey, value: _deletePayload() } as const, materialRequirement: ProviderEffectMaterialRequirements.None };

		await expect(handler.execute(command, {})).rejects.toBeInstanceOf(ProviderEffectOutcomeUncertainError);
		expect(_TELEMETRY.traceNames).not.toContain("kubernetes.provider-secret.clear");
		expect(_TELEMETRY.markActiveSpanFailed).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("turns an ambiguous direct model registration into sticky uncertainty", async function _UncertainModelRegistration()
	{
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm:4000");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
		const handler = new DefaultProviderEffectCommandHandler(null, null, _LOGGER);
		const command = { ..._command(), payload: { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: "global", clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null, routingDefaultId: null, selectedModelDefinitionId: null } } as const, resourceKind: "model-definition", resourceId: "model-1", materialRequirement: ProviderEffectMaterialRequirements.None };

		await expect(handler.execute(command, {})).rejects.toBeInstanceOf(ProviderEffectOutcomeUncertainError);
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("uses the model definition identity to reconcile direct registration across command retries", async function _StableDirectRegistration()
	{
		vi.stubEnv("LITELLM_ENDPOINT", "http://litellm:4000");
		vi.stubEnv("LITELLM_MASTER_KEY", "master");
		let deployment: Record<string, unknown> | null = null;
		const fetchMock = vi.fn(async function _Fetch(url: string, init?: RequestInit): Promise<Response>
		{
			if (url.endsWith("/model/info"))
				return new Response(JSON.stringify({ data: deployment === null ? [] : [deployment] }), { status: 200 });
			if (url.endsWith("/model/new"))
			{
				const body = JSON.parse(init?.body as string) as { model_name: string; litellm_params: Record<string, unknown>; model_info: { id: string } };
				deployment = { model_name: body.model_name, litellm_params: body.litellm_params, model_info: { id: body.model_info.id } };
				return new Response(JSON.stringify({ model_id: body.model_info.id }), { status: 200 });
			}
			return new Response("not found", { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const handler = new DefaultProviderEffectCommandHandler(null, null, _LOGGER);
		const payload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: "global", clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null, routingDefaultId: null, selectedModelDefinitionId: null } } as const;
		const command = { ..._command(), payload, resourceKind: "model-definition", resourceId: "model-1", materialRequirement: ProviderEffectMaterialRequirements.None };

		const first = await handler.execute({ ...command, id: "command-a" }, {});
		const second = await handler.execute({ ...command, id: "command-b" }, {});

		expect(second).toEqual(first);
		expect(fetchMock.mock.calls.filter(function _ModelCreates(call) { return (call[0] as string).endsWith("/model/new"); })).toHaveLength(1);
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("keeps raw adapter errors outside trace and log boundaries", async function _RedactsRawFailure()
	{
		_TELEMETRY.traceThrown.length = 0;
		_TELEMETRY.markActiveSpanFailed.mockClear();
		_TELEMETRY.warn.mockClear();
		const command = _command();
		const repository = {
			claim: vi.fn(async function _Claim() { return { status: ProviderEffectExecutionStatuses.Claimed, command }; }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			fail: vi.fn(async function _Fail() { return ProviderEffectExecutionStatuses.AwaitingMaterial; }),
		} as unknown as ProviderEffectCommandRepository;
		const handler = { execute: vi.fn(async function _Execute() { throw new Error("raw Secret body contains sk-provider-material"); }) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);

		await expect(executor.execute(command.id, { provider: "openai", providerKey: "sk-provider-material" }, _CONTEXT)).resolves.toEqual({ status: ProviderEffectExecutionStatuses.AwaitingMaterial, result: null });
		expect(_TELEMETRY.traceThrown).toEqual([]);
		expect(JSON.stringify(_TELEMETRY.warn.mock.calls)).not.toContain("sk-provider-material");
		expect(_TELEMETRY.warn).toHaveBeenCalledWith(expect.objectContaining({ err: { type: "Error" } }), "provider effect delivery failed and remains recoverable");
		expect(_TELEMETRY.markActiveSpanFailed).toHaveBeenCalledTimes(2);
	});

	it.each([ProviderEffectCommandKinds.SetByokKey, ProviderEffectCommandKinds.DeleteByokKey, ProviderEffectCommandKinds.RegisterModel])("keeps generation B blocked until uncertain %s generation A positively converges", async function _UncertainBarrier(kind)
	{
		let barrier = true;
		let releaseUncertain: (() => void) | null = null;
		const payload = kind === ProviderEffectCommandKinds.SetByokKey
			? { kind, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const
			: kind === ProviderEffectCommandKinds.DeleteByokKey
				? { kind, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } } as const
				: { kind, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: "global", clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null, routingDefaultId: null, selectedModelDefinitionId: null } } as const;
		const register = kind === ProviderEffectCommandKinds.RegisterModel;
		const context = register ? { ..._CONTEXT, resourceKind: "model-definition", resourceId: "model-1" } : _CONTEXT;
		const materialVerifier = kind === ProviderEffectCommandKinds.SetByokKey ? _command().materialVerifier : null;
		const materialRequirement = kind === ProviderEffectCommandKinds.SetByokKey ? ProviderEffectMaterialRequirements.EphemeralProviderKey : ProviderEffectMaterialRequirements.None;
		const first = { ..._command(), payload, resourceKind: context.resourceKind, resourceId: context.resourceId, materialVerifier, materialRequirement };
		const retry = { ...first, deliveryCount: 4, claimFence: "fence-retry", failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE };
		const repository = {
			claim: vi.fn()
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Claimed, command: first })
				.mockResolvedValueOnce({ status: ProviderEffectExecutionStatuses.Claimed, command: retry }),
			preflight: vi.fn(async function _Preflight() { return true; }),
			retainClaim: vi.fn(async function _Retain() { barrier = true; return ProviderEffectExecutionStatuses.Retryable; }),
			complete: vi.fn(async function _Complete() { barrier = false; return { status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand: null }; }),
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
			? { kind, provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", models: [], embedding: { status: ProviderEmbeddingReconciliationStatuses.NotApplicable, deployments: [] } } as const
			: kind === ProviderEffectCommandKinds.DeleteByokKey ? { kind, provider: "openai" } as const : { kind, litellmModelId: "deployment-1" } as const;
		const handler = { execute: vi.fn().mockReturnValueOnce(uncertainDelivery).mockResolvedValueOnce(successfulResult) } as ProviderEffectCommandHandler;
		const executor = new DefaultProviderEffectCommandExecutor(_unitOfWork(repository), handler, _CONTEXT.executorProfile, _LOGGER);
		const material = kind === ProviderEffectCommandKinds.SetByokKey ? { provider: "openai", providerKey: "sk-test" } : undefined;

		const delayed = executor.execute(first.id, material, context);
		await vi.waitFor(function _DeliveryStarted() { expect(handler.execute).toHaveBeenCalledOnce(); });
		await expect(repository.admit({} as never)).resolves.toMatchObject({ status: ProviderEffectAdmissionStatuses.Busy });
		releaseUncertain!();
		await expect(delayed).resolves.toEqual({ status: ProviderEffectExecutionStatuses.Retryable, result: null });
		await expect(repository.admit({} as never)).resolves.toMatchObject({ status: ProviderEffectAdmissionStatuses.Busy });
		await expect(executor.execute(first.id, material, context)).resolves.toMatchObject({ status: ProviderEffectExecutionStatuses.Succeeded });
		await expect(repository.admit({} as never)).resolves.toMatchObject({ status: ProviderEffectAdmissionStatuses.Admitted });
		expect(repository.fail).not.toHaveBeenCalled();
		expect(repository.retainClaim).toHaveBeenCalledWith(first, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE);
	});
});
