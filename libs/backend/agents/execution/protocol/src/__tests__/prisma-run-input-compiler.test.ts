import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PROMPT_COMPILER_VERSION, RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/_server/memory-gateway-client";

import { __CreatePrismaRunInputCompiler } from "../prisma-run-input-compiler.js";

/** Compute the canonical digest frozen for one fact's content. */
function _digest(content: string): string
{
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Build a snapshot whose frozen memory policy names the exact recall coordinates. */
function _snapshot(overrides: Partial<RunInputSnapshot> = {}): RunInputSnapshot
{
	return {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "svc-1",
		agentRevisionId: "rev-1",
		snapshotVersion: 1,
		threadId: "thread-1",
		messageIds: [],
		personaRevisionId: null,
		preferenceFactIds: [],
		artifactRevisionIds: [],
		skillRevisionIds: [],
		memoryFacts: [{ datasetId: "dataset-1", factId: "fact-a", contentDigest: _digest("first fact"), provenance: [] }, { datasetId: "dataset-1", factId: "fact-b", contentDigest: _digest("second fact"), provenance: [] }],
		memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1", queryText: "what did we decide", maxFacts: 8 },
		integrationAssignments: [],
		modelRoute: { alias: "silo-default" },
		budgetPolicy: {},
		identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 3, fleetMembershipIssuer: "fleet", fleetMembershipIssuerKeyId: "k1", fleetMembershipAssertionId: "a1", fleetMembershipPayloadDigest: `sha256:${"c".repeat(64)}`, fleetMembershipTrustedUntil: "2026-08-05T00:00:00.000Z" },
		capabilitySetDigest: `sha256:${"d".repeat(64)}`,
		effectiveContractDigest: `sha256:${"e".repeat(64)}`,
		promptCompilerVersion: PROMPT_COMPILER_VERSION,
		digest: `sha256:${"f".repeat(64)}`,
		compiledAt: "2026-08-04T00:00:00.000Z",
		...overrides,
	};
}

/** Build the immutable-record transaction reads the offline compile steps use. */
function _transaction(): never
{
	return {
		personaRevision: { findUnique: vi.fn().mockResolvedValue(null) },
		conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
		artifactRevision: { findMany: vi.fn().mockResolvedValue([]) },
		skillRevision: { findMany: vi.fn().mockResolvedValue([]) },
		modelDefinition: { findFirst: vi.fn().mockResolvedValue(null) },
	} as never;
}

describe("__CreatePrismaRunInputCompiler memory statements", function _describePrismaRunInputCompiler()
{
	it("inlines digest-verified statements in the sorted frozen reference order", async function _inlinesVerifiedStatements()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-b", content: "second fact" }, { factId: "fact-a", content: "first fact" }, { factId: "fact-unrelated", content: "noise" }] });
		const compiled = await __CreatePrismaRunInputCompiler({ query } as never)(_snapshot(), _transaction());

		expect(compiled.instructions).toContain("Durable memory available for this run:\n- first fact\n- second fact");
		expect(query).toHaveBeenCalledWith({ siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", subjectId: "user-1", query: "what did we decide", maxResults: 32 });
	});

	it("fails closed when recalled content no longer matches a frozen digest", async function _failsOnDigestDrift()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-a", content: "first fact" }, { factId: "fact-b", content: "tampered fact" }] });

		await expect(__CreatePrismaRunInputCompiler({ query } as never)(_snapshot(), _transaction())).rejects.toThrow(/failed digest verification/);
	});

	it("fails closed when a frozen fact reference is missing from recall", async function _failsOnMissingFact()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-a", content: "first fact" }] });

		await expect(__CreatePrismaRunInputCompiler({ query } as never)(_snapshot(), _transaction())).rejects.toThrow(/failed digest verification/);
	});

	it("fails closed when the frozen policy lacks personal recall coordinates", async function _failsOnMissingPolicy()
	{
		const query = vi.fn();

		await expect(__CreatePrismaRunInputCompiler({ query } as never)(_snapshot({ memoryQueryPolicy: { scope: "none" } }), _transaction())).rejects.toThrow(/cannot resolve frozen fact references/);
		expect(query).not.toHaveBeenCalled();
	});

	it("never contacts the gateway for a snapshot with no frozen fact references", async function _compilesOfflineWithoutFacts()
	{
		const compiled = await __CreatePrismaRunInputCompiler(new __UnavailableMemoryGatewayClient())(_snapshot({ memoryFacts: [], memoryQueryPolicy: { scope: "none" } }), _transaction());

		expect(compiled.instructions).not.toContain("Durable memory");
	});
});
