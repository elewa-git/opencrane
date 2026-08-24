import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMcpOperatorRepository } from "../core/prisma-mcp-operator-repository";
import type { McpOperatorServerRecord, McpRemoteServerRegistrationRecord } from "../core/mcp-operator-repository.types";

/** Return the fixed registration used to prove typed claim ordering. */
function _Registration(): McpRemoteServerRegistrationRecord
{
	return {
		siloId: "silo-1",
		name: "Example MCP",
		description: "Public tools",
		endpoint: "https://mcp.example.test/",
		registrationKeyDigest: `sha256:${"a".repeat(64)}`,
		registrationDigest: `sha256:${"b".repeat(64)}`,
	};
}

/** Return the stored draft selected by registration operations. */
function _Server(registration: McpRemoteServerRegistrationRecord): McpOperatorServerRecord
{
	return { id: "server-1", name: registration.name, description: registration.description, publisher: null, glyph: null, serverType: "MultiUser", approvalStatus: "PendingReview", credentialSchema: [], entitlementSummary: null, endpoint: registration.endpoint, registrationKeyDigest: registration.registrationKeyDigest, registrationDigest: registration.registrationDigest, eraProbeStatus: "Pending", eraProtocolVersion: null, eraProbeEvidenceDigest: null, eraProbeFailureCode: null, eraProbeAttempts: 0 };
}

/** Derive the exact fixed-width claim identity expected from the adapter. */
function _ClaimDigest(kind: "key" | "name", value: string): string
{
	return `sha256:${createHash("sha256").update(`${kind}:${value}`).digest("hex")}`;
}

describe("Prisma MCP registration claims", function _RegistrationClaimsSuite()
{
	it("claims key and name in stable order before it creates a draft", async function _ClaimsBeforeCreate()
	{
		const registration = _Registration();
		const events: string[] = [];
		const claimUpsert = vi.fn().mockImplementation(function _Claim(input: { create: { identityDigest: string } })
		{
			events.push(`claim:${input.create.identityDigest}`);
			return Promise.resolve({ identityDigest: input.create.identityDigest });
		});
		const findUnique = vi.fn()
			.mockImplementationOnce(function _ByKey() { events.push("find:key"); return Promise.resolve(null); })
			.mockImplementationOnce(function _ByName() { events.push("find:name"); return Promise.resolve(null); });
		const create = vi.fn().mockImplementation(function _Create() { events.push("create"); return Promise.resolve(_Server(registration)); });
		const transaction = { mcpRegistrationClaim: { upsert: claimUpsert }, mcpServer: { findUnique, create } } as unknown as Prisma.TransactionClient;

		const result = await new PrismaMcpOperatorRepository(transaction).createOrFindRemoteServer(registration);

		const expectedClaims = [
			_ClaimDigest("key", registration.registrationKeyDigest),
			_ClaimDigest("name", registration.name),
		].sort();
		expect(events).toEqual([`claim:${expectedClaims[0]}`, `claim:${expectedClaims[1]}`, "find:key", "find:name", "create"]);
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eraProbeStatus: "Pending" }) }));
		expect(result).toEqual({ created: true, server: _Server(registration) });
	});

	it("returns the existing key owner after taking both claims", async function _ReturnsExistingOwner()
	{
		const registration = _Registration();
		const server = _Server(registration);
		const claimUpsert = vi.fn().mockResolvedValue({ identityDigest: "claim" });
		const findUnique = vi.fn().mockResolvedValueOnce(server);
		const create = vi.fn();
		const transaction = { mcpRegistrationClaim: { upsert: claimUpsert }, mcpServer: { findUnique, create } } as unknown as Prisma.TransactionClient;

		const result = await new PrismaMcpOperatorRepository(transaction).createOrFindRemoteServer(registration);

		expect(claimUpsert).toHaveBeenCalledTimes(2);
		expect(findUnique).toHaveBeenCalledTimes(1);
		expect(create).not.toHaveBeenCalled();
		expect(result).toEqual({ created: false, server });
	});
});

describe("Prisma MCP approval transitions", function _ApprovalTransitionsSuite()
{
	it("publishes only a server that is already approved and has accepted probe evidence", async function _RequiresApprovedSource()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const findFirst = vi.fn();
		const transaction = { mcpServer: { updateMany, findFirst } } as unknown as Prisma.TransactionClient;

		const result = await new PrismaMcpOperatorRepository(transaction).setApprovalStatus("silo-1", "server-1", "Published", ["Accepted", "NotRequired"], "Approved");

		expect(result).toBeNull();
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "server-1", siloId: "silo-1", eraProbeStatus: { in: ["Accepted", "NotRequired"] }, approvalStatus: "Approved" }, data: { approvalStatus: "Published" } });
		expect(findFirst).not.toHaveBeenCalled();
	});
});
