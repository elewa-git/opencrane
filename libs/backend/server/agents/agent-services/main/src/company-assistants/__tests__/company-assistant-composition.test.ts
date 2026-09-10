import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { _CreateCompanyAssistantComposition } from "../company-assistant-composition";

/** Restores the isolated database/history ports after the real route and publication composition runs. */
afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("company assistant application composition", function _Suite()
{
	it("publishes a fresh two-call revision without increasing its total token or time ceilings", async function _PublishesToolCapableBudget()
	{
		vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:allowed" } } as never);
		vi.spyOn(PrismaManagedAuthorizationGrantRepository.prototype, "reconcileManagedResourceGrants").mockResolvedValue(1);
		vi.spyOn(AgentIdentityHistory.prototype, "load").mockResolvedValue(null);
		vi.spyOn(AgentIdentityHistory.prototype, "loadActive").mockResolvedValue({ identity: { kind: "managed" } } as never);
		let committed = false;
		const append = vi.spyOn(AgentIdentityHistory.prototype, "append").mockImplementation(async function _AfterCommit()
		{
			expect(committed).toBe(true);
			return {} as never;
		});
		const transaction = {
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "admin", subject: "admin-subject" }]), create: vi.fn().mockResolvedValue({}) },
			orgMembership: { findMany: vi.fn().mockResolvedValue([{ subject: "admin-subject" }]) },
			agentService: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
			agentRevision: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
		};
		const prisma = { $transaction: vi.fn().mockImplementation(async function _Commit(operation)
		{
			const result = await operation(transaction);
			committed = true;
			return result;
		}) };
		const app = express();
		app.use(express.json());
		app.use(function _Authenticated(request, _response, next)
		{
			request.session = { authUser: { authenticatedAt: new Date().toISOString() } } as never;
			request.authenticatedPrincipal = { principalId: "admin", siloId: "acme", issuer: "https://identity.example", subject: "admin-subject" };
			next();
		});
		app.use(_CreateCompanyAssistantComposition(prisma as never, {} as never, { profileName: "company-test-profile" }, { warn: vi.fn() } as never));
		const response = await request(app).post("/").set("Host", "acme.opencrane.test").send({ name: "Company assistant", modelDefinitionId: "model-1", invokerPrincipalIds: ["admin"] }).expect(201);
		expect(response.body.created).toBe(true);
		expect(transaction.agentRevision.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: expect.objectContaining({ budget: { maxTurns: 2, maxTokens: 32_000, maxDurationMs: 120_000 }, promptPolicyVersion: PROMPT_COMPILER_VERSION, mcpToolAssignments: { create: [] } }) }));
		expect(transaction.agentService.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workloadProfile: "company-test-profile" }) }));
		expect(append).toHaveBeenCalledTimes(1);
	});
});
