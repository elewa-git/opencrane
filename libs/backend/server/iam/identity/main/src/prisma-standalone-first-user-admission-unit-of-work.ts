import { Prisma, type PrismaClient } from "@prisma/client";

import { _ClaimStandaloneFirstUserOwner, PrismaStandaloneFirstUserAdmissionRepository } from "./prisma-standalone-first-user-admission-repository.js";
import { type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionResult, type StandaloneFirstUserAdmissionUnitOfWork, type StandaloneFirstUserOwnerClaim } from "./standalone-first-user-admission.types.js";

/**
 * Opens the serializable transaction for a first-owner claim and retries a lost race exactly once.
 *
 * Serializable isolation plus the unique constraint on the owner row means two simultaneous logins
 * cannot both create an owner: one fails with a unique violation (P2002) or a serialization failure
 * (P2034). Retrying once is enough, because the slot is now filled — the second attempt reads it and
 * returns `AlreadyOwner` or `AlreadyClaimed` instead of racing again.
 *
 * Called by: OidcAuthService.onLoginEstablished in this package, composed with the audit appender
 * from apps/opencrane/src/app/public-app.ts.
 * @implements StandaloneFirstUserAdmissionUnitOfWork
 */
export class PrismaStandaloneFirstUserAdmissionUnitOfWork implements StandaloneFirstUserAdmissionUnitOfWork
{
  /** Root product-authority database client that can open the required transaction. */
  private readonly prisma: PrismaClient;
  /** Audit authority composed outside identity and invoked inside the selected transaction. */
  private readonly audit: StandaloneFirstUserAdmissionAuditPort;

  /**
   * @param prisma - Full client, used only to open serializable owner-claim transactions.
   * @param audit - Audit appender invoked inside each of those transactions.
   */
  constructor(prisma: PrismaClient, audit: StandaloneFirstUserAdmissionAuditPort)
  {
    this.prisma = prisma;
    this.audit = audit;
  }

  /** @inheritdoc */
  async claimOwner(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserAdmissionResult>
  {
    try
    {
      return await this._claimWithinTransaction(claim);
    }
    catch (error)
    {
      if (!_isConcurrentClaimError(error))
      {
        throw error;
      }
      return this._claimWithinTransaction(claim);
    }
  }

  /** Runs one owner-slot decision at serializable isolation. */
  private async _claimWithinTransaction(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserAdmissionResult>
  {
    const audit = this.audit;
    return this.prisma.$transaction(async function _claimOwner(transaction: Prisma.TransactionClient)
    {
      return _ClaimStandaloneFirstUserOwner(new PrismaStandaloneFirstUserAdmissionRepository(transaction, audit), claim);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

/** Returns true for the two Prisma errors a concurrent owner claim raises: P2002 and P2034. */
function _isConcurrentClaimError(error: unknown): boolean
{
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034");
}
