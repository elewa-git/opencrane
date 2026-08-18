import { Router, type RequestHandler } from "express";
import { z } from "zod";

import type { OrganizationMembershipAuthority, OrganizationMembershipCallerResolver } from "./authority.types";
import { OrganizationMemberRoles } from "./directory.types";
import { OrganizationMembershipError, OrganizationMembershipErrorKinds } from "./organization-members.errors";

/** Bounds one recipient batch before domain validation reaches persistence or Fleet. */
const _RecipientsSchema = z.object({ emails: z.array(z.string().max(320)).min(1).max(50) }).strict();

/** Bounds one invitation create request; identity and silo are deliberately absent. */
const _CreateSchema = _RecipientsSchema.extend({ role: z.union([z.literal(OrganizationMemberRoles.Admin), z.literal(OrganizationMemberRoles.Member)]) }).strict();

/** Bounds the bearer token without attempting to interpret its signed contents. */
const _AcceptSchema = z.object({ token: z.string().min(32).max(2_048) }).strict();

/** Maps stable domain failures to API status without exposing Fleet or database details. */
function _status(error: OrganizationMembershipError): number
{
	switch (error.kind)
	{
		case OrganizationMembershipErrorKinds.Forbidden: return 403;
		case OrganizationMembershipErrorKinds.Conflict: return 409;
		case OrganizationMembershipErrorKinds.IdentityMismatch: return 422;
		case OrganizationMembershipErrorKinds.Expired: return 410;
		case OrganizationMembershipErrorKinds.AlreadyUsed: return 409;
		case OrganizationMembershipErrorKinds.Invalid: return 400;
		case OrganizationMembershipErrorKinds.Unavailable: return 503;
		case OrganizationMembershipErrorKinds.PaymentRequired: return 402;
	}
}

/** Requires the standard idempotency header without accepting a body fallback. */
function _idempotencyKey(value: string | string[] | undefined): string
{
	if (typeof value !== "string") throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "Idempotency-Key header is required");
	return value;
}

/** Requires one scalar Express path parameter. */
function _pathParameter(value: string | string[] | undefined): string
{
	if (typeof value !== "string" || value.length === 0) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Invalid, "invitationId path parameter is required");
	return value;
}

/** Converts thrown domain and validation errors to the shared JSON error shape. */
function _handle(handler: RequestHandler): RequestHandler
{
	return async function _HandleOrganizationMemberRequest(request, response, next): Promise<void>
	{
		try { await handler(request, response, next); }
		catch (error)
		{
			if (error instanceof OrganizationMembershipError)
			{
				response.status(_status(error)).json({ error: error.message, code: error.kind });
				return;
			}
			if (error instanceof z.ZodError)
			{
				response.status(400).json({ error: "request body is invalid", code: OrganizationMembershipErrorKinds.Invalid });
				return;
			}
			next(error);
		}
	};
}

/**
 * Creates the authenticated organisation-member directory and invitation routes.
 *
 * The resolver is the sole identity input. Request bodies never carry subject, silo, verified email,
 * or deployment mode. The injected authority is already either standalone or Fleet, so a request
 * cannot select the billing owner and no failed Fleet call can reach local persistence.
 *
 * Called by: apps/opencrane/src/app/routes.ts at `/api/v1/organization/members`.
 * @param authority - Startup-selected standalone or Fleet authority.
 * @param resolveCaller - Maps the verified OIDC session and trusted request host.
 * @returns Router serving directory, validation, create, resend, and acceptance.
 */
export function _CreateOrganizationMembersRouter(authority: OrganizationMembershipAuthority, resolveCaller: OrganizationMembershipCallerResolver): Router
{
	const router = Router();
	router.get("/", _handle(async function _Directory(request, response)
	{
		const caller = resolveCaller(request);
		if (caller === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "authenticated organization identity is required");
		response.json(await authority.directory(caller));
	}));
	router.post("/invitations/validate", _handle(async function _Validate(request, response)
	{
		const caller = resolveCaller(request);
		if (caller === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "authenticated organization identity is required");
		const body = _RecipientsSchema.parse(request.body);
		response.json(await authority.validate({ caller, emails: body.emails }));
	}));
	router.post("/invitations", _handle(async function _Create(request, response)
	{
		const caller = resolveCaller(request);
		if (caller === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "authenticated organization identity is required");
		const body = _CreateSchema.parse(request.body);
		const result = await authority.create({ caller, emails: body.emails, role: body.role, idempotencyKey: _idempotencyKey(request.headers["idempotency-key"]) });
		response.status(result.createdCount > 0 ? 201 : 200).json(result);
	}));
	router.post("/invitations/:invitationId/resend", _handle(async function _Resend(request, response)
	{
		const caller = resolveCaller(request);
		if (caller === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "authenticated organization identity is required");
		response.json(await authority.resend({ caller, invitationId: _pathParameter(request.params.invitationId), idempotencyKey: _idempotencyKey(request.headers["idempotency-key"]) }));
	}));
	router.post("/invitations/accept", _handle(async function _Accept(request, response)
	{
		const caller = resolveCaller(request);
		if (caller === null) throw new OrganizationMembershipError(OrganizationMembershipErrorKinds.Forbidden, "authenticated organization identity is required");
		const body = _AcceptSchema.parse(request.body);
		response.json(await authority.accept({ caller, token: body.token }));
	}));
	return router;
}
