import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionCommand, type StandaloneFirstUserAdmissionConfig, type StandaloneFirstUserAdmissionRepository, type StandaloneFirstUserAdmissionResult } from "./standalone-first-user-admission.types.js";

/**
 * Admit the configured first owner of one standalone silo from verified callback facts only.
 * Email is a one-time eligibility check; the durable record is always bound to the OIDC subject.
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
