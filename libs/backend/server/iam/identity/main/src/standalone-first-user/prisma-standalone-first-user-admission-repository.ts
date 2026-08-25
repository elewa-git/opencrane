import { OrgMemberStatus, OrgRole, type Prisma } from "@prisma/client";

import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserOwnerClaim, type StandaloneFirstUserOwnerClaimRepository, type StandaloneFirstUserStoredMembership } from "./standalone-first-user-admission.types";

/** Copies the three stored membership fields the decision needs into the port's type. */
function _storedMembership(row: { subject: string; role: OrgRole; status: OrgMemberStatus }): StandaloneFirstUserStoredMembership
{
  return { subject: row.subject, role: row.role, status: row.status };
}

/**
 * Reads and writes the OrgMembership rows for one owner-slot decision, inside a given transaction.
 *
 * It never opens a transaction of its own — {@link PrismaStandaloneFirstUserAdmissionUnitOfWork} does
 * that and constructs one of these per attempt.
 *
 * @implements StandaloneFirstUserOwnerClaimRepository
 */
export class PrismaStandaloneFirstUserAdmissionRepository implements StandaloneFirstUserOwnerClaimRepository
{
  /** Transaction selected by the owning unit of work. */
  private readonly prisma: Prisma.TransactionClient;
  /** Audit authority supplied by the app composition root. */
  private readonly audit: StandaloneFirstUserAdmissionAuditPort;

  /**
   * @param prisma - The open serializable transaction for this one owner-slot decision.
   * @param audit - Audit appender that writes into that same transaction.
   */
  constructor(prisma: Prisma.TransactionClient, audit: StandaloneFirstUserAdmissionAuditPort)
  {
    this.prisma = prisma;
    this.audit = audit;
  }

  /** @inheritdoc */
  async findMembership(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserStoredMembership | null>
  {
    const membership = await this.prisma.orgMembership.findUnique({
      where: { clusterTenant_subject: { clusterTenant: claim.clusterTenant, subject: claim.subject } },
      select: { subject: true, role: true, status: true },
    });
    return membership === null ? null : _storedMembership(membership);
  }

  /** @inheritdoc */
  async findOwner(clusterTenant: string): Promise<StandaloneFirstUserStoredMembership | null>
  {
    const owner = await this.prisma.orgMembership.findFirst({
      where: { clusterTenant, role: OrgRole.Owner },
      select: { subject: true, role: true, status: true },
    });
    return owner === null ? null : _storedMembership(owner);
  }

  /** @inheritdoc */
  async createOwner(claim: StandaloneFirstUserOwnerClaim): Promise<void>
  {
    await this.prisma.orgMembership.create({
      data: {
        clusterTenant: claim.clusterTenant,
        subject: claim.subject,
        role: OrgRole.Owner,
        status: OrgMemberStatus.Active,
      },
    });
  }

  /** @inheritdoc */
  async appendOwnerAdmissionAudit(claim: StandaloneFirstUserOwnerClaim): Promise<void>
  {
    await this.audit.append(this.prisma, claim);
  }
}

/**
 * Runs the owner-slot decision: is the slot already this subject's, already someone else's, or free?
 *
 * The order of the checks is the safety property. A membership row for this exact subject is the only
 * idempotent success, and only while it is an active Owner — a suspended or demoted row counts as
 * claimed. Any other existing owner ends it. Only a genuinely empty slot reaches the eligibility
 * check, and the audit row is written in the same transaction as the new owner row.
 *
 * Called by: PrismaStandaloneFirstUserAdmissionUnitOfWork in this package.
 * @param store - Transaction-scoped reads and writes for one attempt.
 * @param claim - Silo, subject, and whether this login may create the owner row.
 * @returns The outcome to report to the login; only `Admitted` created anything.
 * @throws Error from Prisma when a concurrent login inserts the owner first (P2002); the unit of
 *         work catches that and retries once.
 */
export async function _ClaimStandaloneFirstUserOwner(store: StandaloneFirstUserOwnerClaimRepository, claim: StandaloneFirstUserOwnerClaim): Promise<{ readonly outcome: StandaloneFirstUserAdmissionOutcomes }>
{
  // 1. Preserve an exact active owner tuple as the only idempotent success case.
  const existingMembership = await store.findMembership(claim);
  if (existingMembership !== null)
  {
    if (existingMembership.role === OrgRole.Owner && existingMembership.status === OrgMemberStatus.Active)
    {
      return { outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyOwner };
    }
    return { outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyClaimed };
  }

  // 2. Refuse to add a second owner or alter a previously claimed membership state.
  const existingOwner = await store.findOwner(claim.clusterTenant);
  if (existingOwner !== null)
  {
    return { outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyClaimed };
  }

  // 3. Require the configured verified email only while filling a genuinely empty owner slot.
  if (!claim.mayCreateOwner)
  {
    return { outcome: StandaloneFirstUserAdmissionOutcomes.NotEligible };
  }

  // 4. Create the sole active owner only after both collision checks saw an empty slot.
  await store.createOwner(claim);

  // 5. Keep an append-only grant record in the same transaction without retaining the bootstrap email.
  await store.appendOwnerAdmissionAudit(claim);
  return { outcome: StandaloneFirstUserAdmissionOutcomes.Admitted };
}
