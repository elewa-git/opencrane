import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaPersonalAgentToolsRepository } from "../prisma-personal-agent-tools-repository";
import { PrismaPersonalAgentToolsUnitOfWork } from "../prisma-personal-agent-tools-unit-of-work";

const _CALLER = { siloId: "silo-1", subjectId: "subject-1" } as const;
const _COMMAND = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-1"] } as const;
const _SELECTION = { agentServiceId: "service-1", activeRevisionId: "revision-2", toolRevisionIds: ["tool-1"] } as const;

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("personal agent tool transaction boundary", function _Suite()
{
	it.each(["P2002", "P2034"])("rechecks the complete selection after a proven %s rollback", async function _Retries(code)
	{
		const setTools = vi.spyOn(PrismaPersonalAgentToolsRepository.prototype, "setTools").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("rolled back", { code, clientVersion: "test" })).mockResolvedValue(_SELECTION);
		const $transaction = vi.fn().mockImplementation(async operation => await operation({}));
		const authority = new PrismaPersonalAgentToolsUnitOfWork({ $transaction } as never);

		await expect(authority.setTools(_CALLER, _COMMAND)).resolves.toEqual(_SELECTION);
		expect(setTools).toHaveBeenCalledTimes(2);
		expect($transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
	});

	it("does not replay an uncertain commit and reads current state in a fresh transaction", async function _UncertainCommit()
	{
		const setTools = vi.spyOn(PrismaPersonalAgentToolsRepository.prototype, "setTools").mockResolvedValue(_SELECTION);
		const getTools = vi.spyOn(PrismaPersonalAgentToolsRepository.prototype, "getTools").mockResolvedValue(_SELECTION);
		const $transaction = vi.fn().mockImplementationOnce(async function _LoseCommitResponse(operation)
		{
			await operation({});
			throw new Error("commit response lost");
		}).mockImplementation(async operation => await operation({}));
		const authority = new PrismaPersonalAgentToolsUnitOfWork({ $transaction } as never);

		await expect(authority.setTools(_CALLER, _COMMAND)).rejects.toThrow("commit response lost");
		expect(setTools).toHaveBeenCalledOnce();
		await expect(authority.getTools(_CALLER)).resolves.toEqual(_SELECTION);
		expect(getTools).toHaveBeenCalledExactlyOnceWith(_CALLER, expect.any(Date));
		expect($transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
	});
});
