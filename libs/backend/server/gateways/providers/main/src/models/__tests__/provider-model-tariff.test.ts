import { afterEach, describe, expect, it, vi } from "vitest";

import { ___DigestCanonicalJson } from "@opencrane/util";

import { _CreateProviderModelTariffLookup } from "../../index";

/** Fixed database time shared by the resolver and strict quote wrapper. */
const _NOW = new Date("2026-10-01T00:00:00.000Z");

/** Builds the exact identity whose digest is stored on a tariff revision. */
function _TariffIdentity(overrides: Record<string, unknown> = {})
{
	return { version: 1, modelAlias: "admitted-model", currency: "EUR", inputEurMicrosPerUnit: "125000", outputEurMicrosPerUnit: "250000", tokenUnit: 1_000_000, maxInputTokens: 1_000, revision: 2, effectiveAt: "2026-09-29T00:00:00.000Z", validUntil: "2027-09-29T00:00:00.000Z", ...overrides };
}

/** Maps one tariff identity to the provider-owned persistence row used by the resolver. */
function _TariffRow(overrides: Record<string, unknown> = {})
{
	const identity = _TariffIdentity(overrides);
	return { id: "tariff-2", siloId: "silo-1", modelDefinitionId: "model-1", revision: identity.revision, digest: ___DigestCanonicalJson(identity), tokenUnit: BigInt(identity.tokenUnit as number), maxInputTokens: identity.maxInputTokens, inputEurMicrosPerUnit: BigInt(identity.inputEurMicrosPerUnit as string), outputEurMicrosPerUnit: BigInt(identity.outputEurMicrosPerUnit as string), effectiveAt: new Date(String(identity.effectiveAt)), validUntil: new Date(String(identity.validUntil)), createdAt: new Date("2026-09-28T00:00:00.000Z") };
}

/** Creates delegate doubles that expose every authority query for focused assertions. */
function _Transaction(options: { readonly models?: readonly Record<string, unknown>[]; readonly tariffs?: readonly Record<string, unknown>[]; readonly now?: Date } = {})
{
	return {
		modelDefinition: { findMany: vi.fn().mockResolvedValue(options.models ?? [{ id: "model-1", litellmModelId: "deployment-1" }]) },
		agentRunAuthorityClock: { findUniqueOrThrow: vi.fn().mockResolvedValue({ now: options.now ?? _NOW }) },
		modelEurTariffRevision: { findMany: vi.fn().mockResolvedValue(options.tariffs ?? [_TariffRow()]) },
	};
}

/** Runs one lookup through the public factory and its strict validation wrapper. */
function _Lookup(transaction: ReturnType<typeof _Transaction>, input: Record<string, unknown> = {})
{
	const lookup = _CreateProviderModelTariffLookup(transaction as never);
	return lookup.lookup({ siloId: "silo-1", modelAlias: "admitted-model", maxCompletionTokens: 3, ...input } as never);
}

describe("provider model tariff lookup", function _ProviderModelTariffSuite()
{
	afterEach(function _RestoreClock()
	{
		vi.useRealTimers();
	});

	it("returns one exact same-silo registered model tariff with a completion-bound quote", async function _ReturnsQuote()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const transaction = _Transaction();

		await expect(_Lookup(transaction)).resolves.toMatchObject({ tariff: { modelAlias: "admitted-model", revision: 2, digest: _TariffRow().digest, inputEurMicrosPerUnit: "125000", outputEurMicrosPerUnit: "250000", tokenUnit: 1_000_000 }, maxCompletionTokens: 3, worstCaseEurMicros: "126" });
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", publicModelName: "admitted-model" }, select: { id: true, litellmModelId: true }, take: 2 });
		expect(transaction.agentRunAuthorityClock.findUniqueOrThrow).toHaveBeenCalledWith({ where: { singleton: 1 }, select: { now: true } });
		expect(transaction.modelEurTariffRevision.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", modelDefinitionId: "model-1", effectiveAt: { lte: _NOW }, validUntil: { gt: _NOW } }, orderBy: { revision: "desc" }, take: 2 });
	});

	it("uses bigint arithmetic for exact ceiling pricing", async function _PricesBigints()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const rate = "9007199254740993";
		const tariffs = [_TariffRow({ inputEurMicrosPerUnit: rate, outputEurMicrosPerUnit: rate, maxInputTokens: 1 })];

		await expect(_Lookup(_Transaction({ tariffs }), { maxCompletionTokens: 1 })).resolves.toMatchObject({ worstCaseEurMicros: "18014398510" });
	});

	it.each([
		["missing", []],
		["ambiguous across accessible scopes", [{ id: "model-global", litellmModelId: "deployment-global" }, { id: "model-tenant", litellmModelId: "pending:tenant-command" }]],
	])("rejects a %s exact-alias model resolution", async function _RejectsModelAmbiguity(_case, models)
	{
		await expect(_Lookup(_Transaction({ models }))).rejects.toThrow("requires one unambiguous model alias");
	});

	it("does not let a same alias in another silo satisfy the lookup", async function _RejectsForeignSilo()
	{
		const transaction = _Transaction({ models: [] });

		await expect(_Lookup(transaction)).rejects.toThrow("requires one unambiguous model alias");
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", publicModelName: "admitted-model" } }));
	});

	it("rejects a model whose provider registration is still pending", async function _RejectsPendingModel()
	{
		const models = [{ id: "model-1", litellmModelId: "pending:command-1" }];

		await expect(_Lookup(_Transaction({ models }))).rejects.toThrow("requires a registered model");
	});

	it.each([
		["no", []],
		["overlapping", [_TariffRow(), _TariffRow({ revision: 3 })]],
	])("rejects %s active tariff revision", async function _RejectsTariffAmbiguity(_case, tariffs)
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		await expect(_Lookup(_Transaction({ tariffs }))).rejects.toThrow("requires one active revision");
	});

	it("uses inclusive start and exclusive end filters against the database clock", async function _UsesDatabaseWindow()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const transaction = _Transaction({ now: _NOW, tariffs: [] });

		await expect(_Lookup(transaction)).rejects.toThrow("requires one active revision");
		expect(transaction.modelEurTariffRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ effectiveAt: { lte: _NOW }, validUntil: { gt: _NOW } }) }));
	});

	it.each([
		["accepts the inclusive effective time", "2026-10-01T00:00:00.000Z", true],
		["rejects the exclusive end time", "2027-10-01T00:00:00.000Z", false],
	] as const)("%s using the database selection window", async function _ChecksWindowBoundary(_case, now, expectedActive)
	{
		const databaseNow = new Date(now);
		vi.useFakeTimers();
		vi.setSystemTime(databaseNow);
		const rows = [_TariffRow({ effectiveAt: "2026-10-01T00:00:00.000Z", validUntil: "2027-10-01T00:00:00.000Z" })];
		const transaction = _Transaction({ now: databaseNow, tariffs: rows });
		transaction.modelEurTariffRevision.findMany.mockImplementation(async function _FindActive(query: { readonly where: { readonly effectiveAt: { readonly lte: Date }; readonly validUntil: { readonly gt: Date } } })
		{
			return rows.filter(row => row.effectiveAt <= query.where.effectiveAt.lte && row.validUntil > query.where.validUntil.gt);
		});

		if (expectedActive)
			await expect(_Lookup(transaction)).resolves.toMatchObject({ tariff: { effectiveAt: "2026-10-01T00:00:00.000Z" } });
		else
			await expect(_Lookup(transaction)).rejects.toThrow("requires one active revision");
	});

	it.each([
		["before the tariff starts", "2026-09-28T23:59:59.999Z"],
		["at the tariff exclusive end", "2027-09-29T00:00:00.000Z"],
	])("rejects when the application clock is %s after the database selected the row", async function _RejectsApplicationClockSkew(_case, applicationNow)
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date(applicationNow));
		const transaction = _Transaction({ now: _NOW });

		await expect(_Lookup(transaction)).rejects.toThrow("outside its validity window");
		expect(transaction.modelEurTariffRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ effectiveAt: { lte: _NOW }, validUntil: { gt: _NOW } }) }));
	});

	it("rejects stored evidence whose digest cannot reproduce the immutable tariff identity", async function _RejectsDigestMismatch()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const tariffs = [{ ..._TariffRow(), digest: `sha256:${"f".repeat(64)}` }];

		await expect(_Lookup(_Transaction({ tariffs }))).rejects.toThrow("digest does not match its identity");
	});

	it("rejects a stored token unit that differs from the versioned tariff schema", async function _RejectsStoredTokenUnit()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const tariffs = [_TariffRow({ tokenUnit: 2_000_000 })];

		await expect(_Lookup(_Transaction({ tariffs }))).rejects.toThrow();
	});

	it("rejects a malformed stored tariff shape", async function _RejectsMalformedStoredTariff()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const tariffs = [_TariffRow({ maxInputTokens: 0 })];

		await expect(_Lookup(_Transaction({ tariffs }))).rejects.toThrow();
	});

	it("rejects caller pricing fields before any provider-owned lookup", async function _RejectsCallerRates()
	{
		const transaction = _Transaction();

		await expect(_Lookup(transaction, { inputEurMicrosPerUnit: "1", outputEurMicrosPerUnit: "1", tokenUnit: 1, revision: 99 })).rejects.toThrow();
		expect(transaction.modelDefinition.findMany).not.toHaveBeenCalled();
	});
});
