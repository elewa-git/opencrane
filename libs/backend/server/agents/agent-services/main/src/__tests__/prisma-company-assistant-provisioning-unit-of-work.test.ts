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
		expect($transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
