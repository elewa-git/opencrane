import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PrismaPersonalMemoryDeliveryLedger, _CreateExternalActionPorts } from "../external-action-ports.factory.js";
import type { InternalRuntimeConfig } from "../../../app/config.types.js";

/** Internal runtime configuration with neither gateway configured. */
function _config(overrides: Partial<InternalRuntimeConfig> = {}): InternalRuntimeConfig
{
	return {
		artifactPreprocessorEnabled: false,
		artifactPreprocessorMaximumOutputBytes: 1_024,
		artifactPreprocessorNamespace: undefined,
		assignmentTtlMilliseconds: 3_600_000,
		channelReplayRouteId: null,
		claimLeaseMilliseconds: 30_000,
		memoryGatewayTokenFile: null,
		memoryGatewayUrl: null,
		commandTtlMilliseconds: 60_000,
		commandRecoveryMilliseconds: 5_000,
		externalActionHttpTimeoutMilliseconds: 30_000,
		managedRuntimeNamespace: undefined,
		obotMcpGatewayUrl: null,
		outboxPruneBatchSize: 100,
		personalRuntimeNamespace: undefined,
		publishedOutboxRetentionMilliseconds: 604_800_000,
		serverNamespace: "opencrane",
		...overrides,
	};
}

/** One faked delivery-ledger delegate operation. */
type _LedgerOperation = (args?: unknown) => Promise<unknown>;

/**
 * Minimal Prisma double exposing only the delivery-ledger delegate.
 *
 * The delegate is typed loosely because Prisma's generated delegate returns `PrismaPromise`, which a
 * hand-written double cannot satisfy; only the operations a case exercises are supplied.
 */
function _prisma(delegate: Partial<Record<"findUnique" | "findFirst" | "create" | "updateMany", _LedgerOperation>>): PrismaClient
{
	return { memoryDeliveryLedger: delegate } as unknown as PrismaClient;
}

describe("external action ports factory", function _FactorySuite()
{
	it("supplies no ports when neither gateway is configured", function _NoPorts()
	{
		const ports = _CreateExternalActionPorts(_prisma({}), _config());
		// An absent port is what preserves the fail-closed stub in the dispatch factory.
		expect(ports.obotMcpInvocation).toBeUndefined();
		expect(ports.memoryGateway).toBeUndefined();
	});

	it("builds only the transports whose gateway URL is configured", function _PartialPorts()
	{
		const obotOnly = _CreateExternalActionPorts(_prisma({}), _config({ obotMcpGatewayUrl: "http://obot-mcp-gateway:8080" }));
		expect(obotOnly.obotMcpInvocation).toBeDefined();
		expect(obotOnly.memoryGateway).toBeUndefined();

		const both = _CreateExternalActionPorts(_prisma({}), _config({ obotMcpGatewayUrl: "http://obot-mcp-gateway:8080", memoryGatewayUrl: "http://memory-gateway:8080", memoryGatewayTokenFile: "/var/run/opencrane/memory-gateway/token" }));
		expect(both.obotMcpInvocation).toBeDefined();
		expect(both.memoryGateway).toBeDefined();
	});

	it("throws at startup for a malformed gateway origin", function _RejectsMalformed()
	{
		expect(function _obot() { return _CreateExternalActionPorts(_prisma({}), _config({ obotMcpGatewayUrl: "https://obot-mcp-gateway:8080/base" })); }).toThrow(/in-cluster HTTP origin/);
		expect(function _memoryGateway() { return _CreateExternalActionPorts(_prisma({}), _config({ memoryGatewayUrl: "http://user:pass@memory-gateway:8080", memoryGatewayTokenFile: "/var/run/opencrane/memory-gateway/token" })); }).toThrow(/in-cluster HTTP origin/);
	});
});

describe("Prisma personal-memory delivery ledger", function _LedgerSuite()
{
	/** Delivery coordinates shared by the ledger cases. */
	const _key = { siloId: "silo-1", cogneeDatasetId: "ds-1", subjectId: "user-1", idempotencyKey: "key-1" };

	it("returns null for an unused delivery key", async function _Unused()
	{
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({ findUnique: async function _findUnique() { return null; } }));
		await expect(ledger.findDelivery(_key)).resolves.toBeNull();
	});

	it("projects stored evidence for a used delivery key", async function _Used()
	{
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({ findUnique: async function _findUnique() { return { contentDigest: `sha256:${"a".repeat(64)}`, cogneeExternalId: "fact-1" }; } }));
		await expect(ledger.findDelivery(_key)).resolves.toEqual({ contentDigest: `sha256:${"a".repeat(64)}`, cogneeExternalId: "fact-1" });
	});

	it("reports a unique violation as a concurrent writer rather than overwriting", async function _Conflict()
	{
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({
			create: async function _create(): Promise<never> { throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }); },
		}));
		await expect(ledger.recordDelivery(_key, { contentDigest: `sha256:${"b".repeat(64)}`, cogneeExternalId: "fact-2" })).resolves.toBe("conflict_existing");
	});

	it("surfaces a non-uniqueness persistence failure instead of hiding it", async function _RealFailure()
	{
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({
			create: async function _create(): Promise<never> { throw new Error("connection lost"); },
		}));
		await expect(ledger.recordDelivery(_key, { contentDigest: `sha256:${"c".repeat(64)}`, cogneeExternalId: "fact-3" })).rejects.toThrow(/connection lost/);
	});

	it("resolves a fact's dataset by its gateway-minted identifier", async function _ResolveDataset()
	{
		const queries: unknown[] = [];
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({
			findFirst: async function _findFirst(args: unknown)
			{
				queries.push(args);
				return { cogneeDatasetId: "ds-7" };
			},
		}));
		await expect(ledger.resolveFactDataset({ siloId: "silo-1", subjectId: "user-1", factId: "fact-9" })).resolves.toEqual({ cogneeDatasetId: "ds-7" });
		expect(queries[0]).toMatchObject({ where: { siloId: "silo-1", subjectId: "user-1", cogneeExternalId: "fact-9" } });
	});

	it("returns null for a fact it never recorded", async function _UnknownFact()
	{
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({ findFirst: async function _findFirst() { return null; } }));
		await expect(ledger.resolveFactDataset({ siloId: "silo-1", subjectId: "user-1", factId: "ghost" })).resolves.toBeNull();
	});

	it("replaces only the live remote identifier after a correction", async function _ReplacesFactReference()
	{
		const updates: unknown[] = [];
		const ledger = new PrismaPersonalMemoryDeliveryLedger(_prisma({
			updateMany: async function _updateMany(args: unknown): Promise<{ readonly count: number }>
			{
				updates.push(args);
				return { count: 1 };
			},
		}));
		await expect(ledger.replaceFactReference({ siloId: "silo-1", subjectId: "user-1", factId: "fact-1", replacementFactId: "fact-2" })).resolves.toBe("replaced");
		expect(updates[0]).toMatchObject({ where: { siloId: "silo-1", subjectId: "user-1", cogneeExternalId: "fact-1" }, data: { cogneeExternalId: "fact-2" } });
	});
});
