import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaCompanyAssistantProvisioningRepository } from "../db/prisma-company-assistant-provisioning";
import { PrismaCompanyAssistantProvisioningUnitOfWork } from "../db/prisma-company-assistant-provisioning-unit-of-work";

const _RESULT = { created: true, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", principalId: "company-principal", agentIdentityId: "identity-1", name: "Company", createdAt: "2026-09-07T10:00:00.000Z", createdByPrincipalId: "admin", identityEventId: "13a9a2a4-4312-4f98-8ea1-bf385afed81a" };
const _CALLER = { siloId: "silo-1", principalId: "admin" };
const _COMMAND = { name: "Company", modelDefinitionId: "model-1", invokerPrincipalIds: ["human-1"] };
const _POLICY = { workloadProfile: "company", promptPolicyVersion: "1", budget: { maxTurns: 1, maxTokens: 4096, maxDurationMs: 60_000 } };

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("PrismaCompanyAssistantProvisioningUnitOfWork", function _Suite()
{
	it.each(["P2002", "P2034"])("retries %s before establishing identity once after the successful commit", async function _Retries(code)
	{
		vi.spyOn(PrismaCompanyAssistantProvisioningRepository.prototype, "provision").mockResolvedValue(_RESULT);
		const $transaction = vi.fn().mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("retry", { code, clientVersion: "test" })).mockImplementation(async operation => await operation({}));
		const identities = { load: vi.fn().mockImplementation(async function _AfterCommit()
		{
			expect($transaction).toHaveBeenCalledTimes(2);
			return { identity: { kind: "managed" } };
		}), append: vi.fn(), loadActive: vi.fn().mockResolvedValue({ identity: { kind: "managed" } }) };
		const authority = new PrismaCompanyAssistantProvisioningUnitOfWork({ $transaction } as never, _POLICY, identities as never);
		await expect(authority.provision(_CALLER, _COMMAND)).resolves.toEqual(_RESULT);
		expect($transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
		expect(identities.load).toHaveBeenCalledTimes(1);
		expect(identities.append).not.toHaveBeenCalled();
	});

	it("bounds repeated creation conflicts and never attempts identity writes before a commit", async function _BoundsRetries()
	{
		const $transaction = vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("retry", { code: "P2002", clientVersion: "test" }));
		const identities = { load: vi.fn(), append: vi.fn(), loadActive: vi.fn() };
		const authority = new PrismaCompanyAssistantProvisioningUnitOfWork({ $transaction } as never, _POLICY, identities as never);
		await expect(authority.provision(_CALLER, _COMMAND)).rejects.toThrow();
		expect($transaction).toHaveBeenCalledTimes(3);
		expect(identities.load).not.toHaveBeenCalled();
		expect(identities.append).not.toHaveBeenCalled();
	});
});

describe("company assistant tool assignment transaction boundary", function _ToolsSuite()
{
	it.each(["P2002", "P2034"])("rechecks current assignment authority after a proven %s rollback without identity writes", async function _RetriesAssignment(code)
	{
		const selection = { agentServiceId: "company", activeRevisionId: "revision-2", toolRevisionIds: ["tool-1"] };
		const setTools = vi.spyOn(PrismaCompanyAssistantProvisioningRepository.prototype, "setTools").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("rolled back", { code, clientVersion: "test" })).mockResolvedValue(selection);
		const $transaction = vi.fn().mockImplementation(async operation => await operation({}));
		const identities = { load: vi.fn(), append: vi.fn(), loadActive: vi.fn() };
		const authority = new PrismaCompanyAssistantProvisioningUnitOfWork({ $transaction } as never, _POLICY, identities as never);
		const command = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-1"] };
		await expect(authority.setTools(_CALLER, command)).resolves.toEqual(selection);
		expect(setTools).toHaveBeenCalledTimes(2);
		expect($transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
		expect(identities.load).not.toHaveBeenCalled();
		expect(identities.append).not.toHaveBeenCalled();
	});

	it("does not replay an uncertain commit and uses GET to read the authoritative current selection", async function _DoesNotReplayUncertainCommit()
	{
		const command = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-1"] };
		const selection = { agentServiceId: "company", activeRevisionId: "revision-2", toolRevisionIds: ["tool-1"] };
		const setTools = vi.spyOn(PrismaCompanyAssistantProvisioningRepository.prototype, "setTools").mockResolvedValue(selection);
		const getTools = vi.spyOn(PrismaCompanyAssistantProvisioningRepository.prototype, "getTools").mockResolvedValue(selection);
		const $transaction = vi.fn().mockImplementationOnce(async function _Uncertain(operation)
		{
			await operation({});
			throw new Error("commit response lost");
		}).mockImplementation(async operation => await operation({}));
		const identities = { load: vi.fn(), append: vi.fn(), loadActive: vi.fn() };
		const authority = new PrismaCompanyAssistantProvisioningUnitOfWork({ $transaction } as never, _POLICY, identities as never);
		await expect(authority.setTools(_CALLER, command)).rejects.toThrow("commit response lost");
		expect(setTools).toHaveBeenCalledTimes(1);
		expect($transaction).toHaveBeenCalledTimes(1);
		await expect(authority.getTools(_CALLER)).resolves.toEqual(selection);
		expect(getTools).toHaveBeenCalledExactlyOnceWith(_CALLER, expect.any(Date));
		expect(identities.load).not.toHaveBeenCalled();
		expect(identities.append).not.toHaveBeenCalled();
	});
});
