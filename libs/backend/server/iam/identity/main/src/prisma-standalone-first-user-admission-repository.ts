import { OrgMemberStatus, OrgRole, type Prisma } from "@prisma/client";

import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserOwnerClaim, type StandaloneFirstUserOwnerClaimRepository, type StandaloneFirstUserStoredMembership } from "./standalone-first-user-admission.types.js";

/** Maps the precise stored fields used by one-time owner admission into the port's vocabulary. */
function _storedMembership(row: { subject: string; role: OrgRole; status: OrgMemberStatus }): StandaloneFirstUserStoredMembership
{
  return { subject: row.subject, role: row.role, status: row.status };
}

/**
 * Transaction-scoped Prisma adapter for the standalone first-owner claim.
 * It owns typed OrgMembership reads/writes; the unit of work owns transaction selection.
 */
export class PrismaStandaloneFirstUserAdmissionRepository implements StandaloneFirstUserOwnerClaimRepository
{
  /** Transaction selected by the owning unit of work. */
  private readonly prisma: Prisma.TransactionClient;
  /** Audit authority supplied by the app composition root. */
  private readonly audit: StandaloneFirstUserAdmissionAuditPort;

  /** @param prisma - Exact serializable transaction for one owner-slot decision. @param audit - Audit authority bound to this transaction. */
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

/** Decides one durable owner claim against a serializable transaction-scoped store. */
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
