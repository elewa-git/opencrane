import { Prisma, type PrismaClient } from "@prisma/client";

import { _ClaimStandaloneFirstUserOwner, PrismaStandaloneFirstUserAdmissionRepository } from "./prisma-standalone-first-user-admission-repository.js";
import { type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionResult, type StandaloneFirstUserAdmissionUnitOfWork, type StandaloneFirstUserOwnerClaim } from "./standalone-first-user-admission.types.js";

/**
 * Owns the serializable transaction that makes a standalone silo's first-owner claim atomic.
 * A one-time retry turns a concurrent unique/serialization collision into the durable result.
 */
export class PrismaStandaloneFirstUserAdmissionUnitOfWork implements StandaloneFirstUserAdmissionUnitOfWork
{
  /** Root product-authority database client that can open the required transaction. */
  private readonly prisma: PrismaClient;
  /** Audit authority composed outside identity and invoked inside the selected transaction. */
  private readonly audit: StandaloneFirstUserAdmissionAuditPort;

  /** @param prisma - Root client used solely to select serializable owner-claim transactions. @param audit - Audit authority for accepted claims. */
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

/** Identifies Prisma's retryable unique or serialization outcomes for one owner-slot race. */
function _isConcurrentClaimError(error: unknown): boolean
{
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034");
}
