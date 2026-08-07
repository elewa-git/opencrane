import { OrgMemberStatus, OrgRole, Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { _AdmitStandaloneFirstUser } from "../standalone-first-user-admission.js";
import { _ClaimStandaloneFirstUserOwner } from "../prisma-standalone-first-user-admission-repository.js";
import { PrismaStandaloneFirstUserAdmissionUnitOfWork } from "../prisma-standalone-first-user-admission-unit-of-work.js";
import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionCommand, type StandaloneFirstUserAdmissionRepository, type StandaloneFirstUserOwnerClaimRepository } from "../standalone-first-user-admission.types.js";

/** Deployment configuration used by first-owner admission tests. */
const _config = { clusterTenant: "testv2", email: "jente@elewa.ke", issuer: "https://idp.example" };

/** A verified callback command that satisfies the configured standalone owner contract. */
function _eligibleCommand(): StandaloneFirstUserAdmissionCommand
{
  return { hostClusterTenant: "testv2", issuer: "https://idp.example", subject: "subject-jente", email: "jente@elewa.ke", emailVerified: true };
}

/** Creates an authority-port stub whose claim operation can be asserted without persistence. */
function _repository(outcome: StandaloneFirstUserAdmissionOutcomes): StandaloneFirstUserAdmissionRepository & { claimOwner: ReturnType<typeof vi.fn> }
{
  const claimOwner = vi.fn(async function _claimOwner() { return { outcome }; });
  return { claimOwner } as StandaloneFirstUserAdmissionRepository & { claimOwner: ReturnType<typeof vi.fn> };
}

describe("_AdmitStandaloneFirstUser", function _admissionSuite()
{
  it("claims only the configured verified email at the host-selected silo", async function _claimsConfiguredUser()
  {
    const repository = _repository(StandaloneFirstUserAdmissionOutcomes.Admitted);

    await expect(_AdmitStandaloneFirstUser(_config, repository, _eligibleCommand())).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.Admitted });

    expect(repository.claimOwner).toHaveBeenCalledWith({ clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: true });
  });

  it("does not let an unverified email create an unclaimed durable owner slot", async function _rejectsUnverifiedEmail()
  {
    const repository = _repository(StandaloneFirstUserAdmissionOutcomes.NotEligible);
    const command = { ..._eligibleCommand(), emailVerified: false };

    await expect(_AdmitStandaloneFirstUser(_config, repository, command)).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.NotEligible });

    expect(repository.claimOwner).toHaveBeenCalledWith({ clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: false });
  });

  it("never grants a different email permission to create an owner slot", async function _rejectsEmailFallback()
  {
    const repository = _repository(StandaloneFirstUserAdmissionOutcomes.NotEligible);
    const command = { ..._eligibleCommand(), email: "jente@another.example" };

    await expect(_AdmitStandaloneFirstUser(_config, repository, command)).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.NotEligible });

    expect(repository.claimOwner).toHaveBeenCalledWith({ clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: false });
  });

  it("still asks persistence to recognize an existing subject-bound owner after an email rename", async function _recognizesExistingOwner()
  {
    const repository = _repository(StandaloneFirstUserAdmissionOutcomes.AlreadyOwner);
    const command = { ..._eligibleCommand(), email: undefined, emailVerified: undefined };

    await expect(_AdmitStandaloneFirstUser(_config, repository, command)).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyOwner });

    expect(repository.claimOwner).toHaveBeenCalledWith({ clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: false });
  });

  it("rejects a verified configured email on a foreign host-selected silo", async function _rejectsForeignHost()
  {
    const repository = _repository(StandaloneFirstUserAdmissionOutcomes.Admitted);
    const command = { ..._eligibleCommand(), hostClusterTenant: "other-silo" };

    await expect(_AdmitStandaloneFirstUser(_config, repository, command)).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.NotEligible });

    expect(repository.claimOwner).not.toHaveBeenCalled();
  });
});

/** Creates a transaction-scoped store with exact membership and owner lookup results. */
function _store(existingMembership: { subject: string; role: OrgRole; status: OrgMemberStatus } | null, existingOwner: { subject: string; role: OrgRole; status: OrgMemberStatus } | null): StandaloneFirstUserOwnerClaimRepository & { appendOwnerAdmissionAudit: ReturnType<typeof vi.fn>; createOwner: ReturnType<typeof vi.fn> }
{
  return {
    findMembership: vi.fn().mockResolvedValue(existingMembership),
    findOwner: vi.fn().mockResolvedValue(existingOwner),
    createOwner: vi.fn().mockResolvedValue(undefined),
    appendOwnerAdmissionAudit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("_ClaimStandaloneFirstUserOwner", function _claimSuite()
{
  it("creates the first active owner and appends its grant evidence in the same transaction store", async function _createsOwner()
  {
    const store = _store(null, null);
    const claim = { clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: true };

    await expect(_ClaimStandaloneFirstUserOwner(store, claim)).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.Admitted });

    expect(store.createOwner).toHaveBeenCalledWith(claim);
    expect(store.appendOwnerAdmissionAudit).toHaveBeenCalledWith(claim);
  });

  it("preserves an active owner tuple for the same subject without creating a second row", async function _isIdempotent()
  {
    const store = _store({ subject: "subject-jente", role: OrgRole.Owner, status: OrgMemberStatus.Active }, null);

    await expect(_ClaimStandaloneFirstUserOwner(store, { clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: false })).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyOwner });

    expect(store.createOwner).not.toHaveBeenCalled();
  });

  it("refuses a silo whose owner slot is already held by another subject", async function _rejectsOtherOwner()
  {
    const store = _store(null, { subject: "other-subject", role: OrgRole.Owner, status: OrgMemberStatus.Active });

    await expect(_ClaimStandaloneFirstUserOwner(store, { clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: false })).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyClaimed });

    expect(store.createOwner).not.toHaveBeenCalled();
  });
});

/** Builds a Prisma surface that turns one concurrent create collision into a persisted other owner. */
function _concurrentOwnerPrisma(): PrismaClient
{
  let owner: { subject: string; role: OrgRole; status: OrgMemberStatus } | null = null;
  let firstCreate = true;
  const transaction = {
    orgMembership: {
      findUnique: vi.fn(async function _findUnique() { return null; }),
      findFirst: vi.fn(async function _findFirst() { return owner; }),
      create: vi.fn(async function _create()
      {
        if (firstCreate)
        {
          firstCreate = false;
          owner = { subject: "other-subject", role: OrgRole.Owner, status: OrgMemberStatus.Active };
          throw new Prisma.PrismaClientKnownRequestError("owner already claimed", { code: "P2002", clientVersion: "test" });
        }
      }),
    },
    auditDecision: { create: vi.fn().mockResolvedValue(undefined) },
  };
  return {
    $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }),
  } as unknown as PrismaClient;
}

describe("PrismaStandaloneFirstUserAdmissionUnitOfWork", function _unitOfWorkSuite()
{
  it("rechecks a serializable owner claim after a concurrent unique collision and denies the newcomer", async function _rejectsConcurrentClaim()
  {
    const unitOfWork = new PrismaStandaloneFirstUserAdmissionUnitOfWork(_concurrentOwnerPrisma());

    await expect(unitOfWork.claimOwner({ clusterTenant: "testv2", subject: "subject-jente", mayCreateOwner: true })).resolves.toEqual({ outcome: StandaloneFirstUserAdmissionOutcomes.AlreadyClaimed });
  });
});
