import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork, type PrismaUnitOfWorkIsolationLevel } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { PersonalAgentToolsAuthority, PersonalAgentToolsCaller, PersonalAgentToolsCommand, PersonalAgentToolsRepository, PersonalAgentToolsSelection } from "../personal-agent-tools.types";
import { PrismaPersonalAgentToolsRepository } from "./prisma-personal-agent-tools-repository";

/** Commits personal tool edits through fresh bounded database transactions. */
export class PrismaPersonalAgentToolsUnitOfWork implements PersonalAgentToolsAuthority
{
	public constructor(private readonly prisma: PrismaClient) {}

	public getTools(caller: PersonalAgentToolsCaller): Promise<PersonalAgentToolsSelection>
	{
		return this._WithRepository(repository => repository.getTools(caller, new Date()), "ReadCommitted", 1);
	}

	public setTools(caller: PersonalAgentToolsCaller, command: PersonalAgentToolsCommand): Promise<PersonalAgentToolsSelection>
	{
		return this._WithRepository(repository => repository.setTools(caller, command, new Date()), "Serializable", 3);
	}

	private _WithRepository<Result>(operation: (repository: PersonalAgentToolsRepository) => Promise<Result>, isolationLevel: PrismaUnitOfWorkIsolationLevel, attemptLimit: number): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Run(transaction)
		{
			return operation(new PrismaPersonalAgentToolsRepository(transaction));
		}, { isolationLevel, attemptLimit, operation: "personal agent tools" });
	}
}
