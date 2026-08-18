import { Prisma, type PrismaClient } from "@prisma/client";

import type { OrganizationMembershipCaller } from "./authority.types";
import type { OrganizationMember } from "./directory.types";
import type { OrganizationInviteRecipientValidation } from "./invitations.types";
import { OrganizationMembershipError, OrganizationMembershipErrorKinds } from "./organization-members.errors";
import type { AcceptStandaloneInvitationCommand, CreateStandaloneInvitationsCommand, CreateStandaloneInvitationsResult, OrganizationInvitationRecord, OrganizationMemberDirectoryRecords, OrganizationMemberRepository, OrganizationMemberTransactionRepository, ResendStandaloneInvitationCommand } from "./organization-member-repository.types";
import { PrismaOrganizationMemberRepository } from "./prisma-organization-member-repository";

/** Opens one Prisma transaction and constructs the invitation delegate owner inside it. */
export class PrismaOrganizationMemberUnitOfWork implements OrganizationMemberRepository
{
	/** Root client that owns transaction lifetime. */
	private readonly prisma: PrismaClient;

	/** @param prisma - Application-owned root client. */
	constructor(prisma: PrismaClient) { this.prisma = prisma; }

	/** @inheritdoc */
	async hasActiveMembership(caller: Pick<OrganizationMembershipCaller, "siloId" | "subjectId">): Promise<boolean>
	{
		return this._withRepository(function _HasActiveMembership(repository) { return repository.hasActiveMembership(caller); });
	}

	/** @inheritdoc */
	async directory(caller: OrganizationMembershipCaller): Promise<OrganizationMemberDirectoryRecords>
	{
		return this._withRepository(function _Directory(repository) { return repository.directory(caller); });
	}

	/** @inheritdoc */
	async validate(caller: OrganizationMembershipCaller, emails: readonly string[], now: Date): Promise<readonly OrganizationInviteRecipientValidation[]>
	{
		return this._withRepository(function _Validate(repository) { return repository.validate(caller, emails, now); });
	}

	/** @inheritdoc */
	async create(command: CreateStandaloneInvitationsCommand): Promise<CreateStandaloneInvitationsResult>
	{
		try
		{
			return await this._withRepository(function _Create(repository) { return repository.create(command); }, Prisma.TransactionIsolationLevel.Serializable);
		}
		catch (error)
		{
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || (error.code !== "P2002" && error.code !== "P2034")) throw error;
			const recovered = await this._withRepository(function _Recover(repository) { return repository.recoverCreate(command); });
			if (recovered !== null) return recovered;
			throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "invitation request conflicted with another command");
		}
	}

	/** @inheritdoc */
	async resend(command: ResendStandaloneInvitationCommand): Promise<OrganizationInvitationRecord>
	{
		try { return await this._withRepository(function _Resend(repository) { return repository.resend(command); }); }
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Conflict, "resend idempotency key was already used by another invitation");
			throw error;
		}
	}

	/** @inheritdoc */
	async accept(command: AcceptStandaloneInvitationCommand): Promise<OrganizationMember>
	{
		return this._withRepository(function _Accept(repository) { return repository.accept(command); });
	}

	/** Opens one transaction and binds the repository to its exact client. */
	private async _withRepository<Result>(operation: (repository: OrganizationMemberTransactionRepository) => Promise<Result>, isolationLevel?: Prisma.TransactionIsolationLevel): Promise<Result>
	{
		return this.prisma.$transaction(async function _Run(transaction)
		{
			return operation(new PrismaOrganizationMemberRepository(transaction));
		}, { isolationLevel });
	}
}
