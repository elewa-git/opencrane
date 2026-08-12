import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionCommand, type StandaloneFirstUserAdmissionConfig, type StandaloneFirstUserAdmissionRepository, type StandaloneFirstUserAdmissionResult } from "./standalone-first-user-admission.types.js";

/**
 * Decides whether this login may become the standalone silo's first owner, then tries to claim it.
 *
 * Two gates. The request host, the issuer, and a non-empty subject must match this deployment's
 * configuration, or the login was never a candidate. Then the configured email — and only a
 * provider-verified one — decides whether an empty owner slot may be filled. The stored owner row is
 * keyed on the OIDC subject, not the email, so a later email change cannot move ownership.
 *
 * Called by: OidcAuthService.onLoginEstablished in this package, on every login of a standalone
 * install.
 * @param config - Configured silo, verified email, and issuer for this deployment.
 * @param repository - Owner-slot store that makes the claim atomic.
 * @param command - Host-derived silo plus the verified issuer, subject, and email claims.
 * @returns `Admitted` or `AlreadyOwner` when the caller owns the silo; `NotEligible` or
 *          `AlreadyClaimed` when it must not proceed.
 */
export async function _AdmitStandaloneFirstUser(config: StandaloneFirstUserAdmissionConfig, repository: StandaloneFirstUserAdmissionRepository, command: StandaloneFirstUserAdmissionCommand): Promise<StandaloneFirstUserAdmissionResult>
{
  if (!_isTrustedHostSubject(config, command))
  {
    return { outcome: StandaloneFirstUserAdmissionOutcomes.NotEligible };
  }

  return repository.claimOwner({ clusterTenant: config.clusterTenant, subject: command.subject, mayCreateOwner: _hasVerifiedBootstrapEmail(config, command) });
}

/** Returns whether the callback host, issuer, and stable subject match this release's owner scope. */
function _isTrustedHostSubject(config: StandaloneFirstUserAdmissionConfig, command: StandaloneFirstUserAdmissionCommand): boolean
{
  return command.hostClusterTenant === config.clusterTenant
    && command.issuer === config.issuer
    && command.subject.trim().length > 0
    && config.issuer.length > 0;
}

/** Returns whether the callback's explicitly verified email may create an unclaimed owner slot. */
function _hasVerifiedBootstrapEmail(config: StandaloneFirstUserAdmissionConfig, command: StandaloneFirstUserAdmissionCommand): boolean
{
  return command.emailVerified === true && command.email?.trim().toLowerCase() === config.email;
}
