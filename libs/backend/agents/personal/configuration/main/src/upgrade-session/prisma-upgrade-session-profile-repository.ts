import { Prisma } from "@prisma/client";

import type { UpgradeSessionProfileReadCommand, UpgradeSessionProfileRepository } from "./upgrade-session.types.js";

/** Transaction-scoped Prisma reader for the personal profile bound to an upgrade session. */
export class PrismaUpgradeSessionProfileRepository implements UpgradeSessionProfileRepository
{
	/** Transaction that also owns the later proposal provenance checks and insert. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the owner-profile reader inside the upgrade-session proposal transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Resolve the unique personal profile owned by the frozen silo and execution subject. */
	async readOwnerProfileId(command: UpgradeSessionProfileReadCommand): Promise<string | null>
	{
		const profile = await this.transaction.personaProfile.findUnique(_profileLookup(command));
		return profile?.id ?? null;
	}
}

/** Initializes the exact owner-profile lookup and its minimal projection. */
function _profileLookup(command: UpgradeSessionProfileReadCommand): Prisma.PersonaProfileFindUniqueArgs
{
	const query: Prisma.PersonaProfileFindUniqueArgs = {
		where: { siloId_userId: { siloId: command.siloId, userId: command.userId } },
		select: { id: true },
	};
	return query;
}
