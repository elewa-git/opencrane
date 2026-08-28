import { createHash, timingSafeEqual } from "node:crypto";

import type { Request } from "express";
import type { Logger } from "pino";

import { TIER3_DEVELOPMENT_PROXY_PROOF_HEADER } from "@opencrane/contracts";
import { _destroySession, _regenerateSession, _ResolveOrgMembershipFacts, _sanitizeReturnTo, _saveSession, type AuthStatus, type OrgMembershipRepository } from "@opencrane/backend/server/infra/auth";

import { PrismaAuthenticatedPrincipalDirectoryUnitOfWork } from "../authenticated-principals/prisma-authenticated-principal-directory-unit-of-work";
import { PrismaGroupClaimProjectionUnitOfWork } from "../group-claims/mirror-groups";
import { PrismaStandaloneFirstUserAdmissionUnitOfWork } from "../standalone-first-user/prisma-standalone-first-user-admission-unit-of-work";
import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionAuditPort } from "../standalone-first-user/standalone-first-user-admission.types";
import type { Tier3DevelopmentAuthenticationConfig } from "./development-auth.types";

/**
 * Establishes the disposable Tier 3 identity through proxy proof, durable Principal projection, and audited Owner admission.
 *
 * Called by: the Tier 3 authentication router selected by the OpenCrane composition root.
 */
export class Tier3DevelopmentAuthService
{
	private readonly config: Tier3DevelopmentAuthenticationConfig;
	private readonly log: Logger;
	private readonly membership: OrgMembershipRepository;
	private readonly prisma: ConstructorParameters<typeof PrismaGroupClaimProjectionUnitOfWork>[0];
	private readonly ownerAdmission: PrismaStandaloneFirstUserAdmissionUnitOfWork;
	private readonly expectedProofDigest: Buffer;

	/**
	 * Stores the fixed authority and hashes the coordinator proof before requests can arrive.
	 *
	 * @param config - Validated fixed identity, expected host, proof, and session lifetime.
	 * @param prisma - Transaction authority for Principal projection, Owner admission, and resolution.
	 * @param membership - Active Owner/Admin reader used for current `/auth/me` introspection.
	 * @param audit - App-owned append port that records the one-time Owner claim.
	 * @param log - Parent logger used for structured identity reconciliation events.
	 */
	constructor(config: Tier3DevelopmentAuthenticationConfig, prisma: ConstructorParameters<typeof PrismaGroupClaimProjectionUnitOfWork>[0], membership: OrgMembershipRepository, audit: StandaloneFirstUserAdmissionAuditPort, log: Logger)
	{
		this.config = config;
		this.prisma = prisma;
		this.membership = membership;
		this.log = log.child({ component: "tier3-development-auth" });
		this.ownerAdmission = new PrismaStandaloneFirstUserAdmissionUnitOfWork(prisma, audit);
		this.expectedProofDigest = _Digest(config.proxySecret);
	}

	/**
	 * Returns the fixed Owner projection only while the signed session matches this run's authority.
	 *
	 * Called by: `/auth/me` and the Tier 3 reauthentication guard.
	 * @param request - Browser request after the shared signed-session middleware has run.
	 * @returns Authenticated status with current durable administration facts, or an anonymous development status.
	 * @throws When current membership authority cannot be read.
	 */
	async getStatus(request: Request): Promise<AuthStatus>
	{
		const user = request.session?.authUser;
		const expiresAt = new Date(user?.authorizationExpiresAt ?? "");
		if (!user || user.issuer !== this.config.issuer || user.siloId !== this.config.siloId || user.sub !== this.config.subject || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
		{
			return { authenticated: false, mode: "development", user: null };
		}
		const membership = await _ResolveOrgMembershipFacts(this.membership, this.config.subject);
		return {
			authenticated: true,
			mode: "development",
			user: {
				...user,
				clusterTenant: this.config.siloId,
				isOrgAdmin: membership.isOrgAdmin,
				isPlatformOperator: false,
				ownedOrgs: membership.ownedOrgs,
			},
		};
	}

	/**
	 * Verifies coordinator proof, admits the durable identity, and creates a rotated bounded session.
	 *
	 * Called by: Tier 3 `/auth/login` and authenticated `/auth/reauthenticate` routes.
	 * @param request - Login request carrying the proxy-only proof and fixed upstream Host.
	 * @param returnTo - Untrusted browser continuation path, sanitized before redirect.
	 * @returns The safe local continuation, or null when proof or Host does not match.
	 * @throws When Principal projection, Owner admission, auditing, or session persistence fails.
	 */
	async login(request: Request, returnTo: string): Promise<string | null>
	{
		if (!this._HasExpectedProof(request) || request.get("host")?.toLowerCase() !== this.config.expectedHost)
		{
			return null;
		}
		await this._AdmitInstalledIdentity();
		await _regenerateSession(request);
		const now = new Date();
		request.session.authUser = {
			authenticatedAt: now.toISOString(),
			authorizationExpiresAt: new Date(now.getTime() + this.config.sessionMaxAgeMilliseconds).toISOString(),
			email: this.config.email,
			emailVerified: false,
			groups: [],
			isOrgAdmin: true,
			isPlatformOperator: false,
			issuer: this.config.issuer,
			name: this.config.displayName,
			siloId: this.config.siloId,
			sub: this.config.subject,
		};
		await _saveSession(request);
		return _sanitizeReturnTo(returnTo);
	}

	/**
	 * Destroys this run's local session without contacting an external identity provider.
	 *
	 * Called by: Tier 3 `/auth/logout`.
	 * @param request - Browser request whose server-side session must be invalidated.
	 * @throws When the session store cannot destroy the session.
	 */
	async logout(request: Request): Promise<void>
	{
		await _destroySession(request);
	}

	/** Reconciles the installed identity and accepts only its exact durable Principal and Owner slot. */
	private async _AdmitInstalledIdentity(): Promise<void>
	{
		await new PrismaGroupClaimProjectionUnitOfWork(this.prisma).reconcile({
			displayName: this.config.displayName,
			email: this.config.email,
			groups: [],
			issuer: this.config.issuer,
			log: this.log,
			siloId: this.config.siloId,
			subject: this.config.subject,
		});
		const owner = await this.ownerAdmission.claimOwner({ clusterTenant: this.config.siloId, mayCreateOwner: true, subject: this.config.subject });
		if (owner.outcome !== StandaloneFirstUserAdmissionOutcomes.Admitted && owner.outcome !== StandaloneFirstUserAdmissionOutcomes.AlreadyOwner)
		{
			throw new Error(`Tier 3 development owner admission denied: ${owner.outcome}`);
		}
		const principal = await new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(this.prisma).resolveAuthenticatedPrincipal(this.config.siloId, this.config.issuer, this.config.subject);
		if (principal === null)
		{
			throw new Error("Tier 3 development Principal projection did not resolve");
		}
	}

	/** Compares fixed-size proof digests so malformed and incorrect secrets share one denial path. */
	private _HasExpectedProof(request: Request): boolean
	{
		const proof = request.headers[TIER3_DEVELOPMENT_PROXY_PROOF_HEADER];
		return typeof proof === "string" && timingSafeEqual(_Digest(proof), this.expectedProofDigest);
	}
}

/** Hash variable-length proof inputs before the constant-time comparison. */
function _Digest(value: string): Buffer
{
	return createHash("sha256").update(value).digest();
}
