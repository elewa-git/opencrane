import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { AgentServicePublicationRepository } from "./agent-publication.types";
import type { AgentRevisionLifecycleRepository, ManagedRunAdmissionPort } from "./agent-revision-lifecycle.types";
import type { AgentScheduleRepository } from "./agent-schedule.types";

/**
 * Who is making a management request, worked out by the app from the browser session and request
 * host — never from the request body.
 *
 * The router trusts these as authenticated identity coordinates only. Each mutation rechecks the
 * caller's current product grant through the transaction-bound AuthorizationAuthority.
 */
export interface ManagementCaller
{
	/** Durable local Principal id used by generic authorization. */
	readonly principalId: string;
	/** Stable IdP subject retained for authorities that still key user-owned records by OIDC subject. */
	readonly externalSubject: string;
	/** Silo the caller is operating within. */
	readonly siloId: string;
}

/** Supplies the timestamps written to `createdAt`, `publishedAt`, and `updatedAt`. It is injected only so tests can fix time; a caller-supplied timestamp must never reach these fields. */
export interface ManagementClock
{
	/** Returns the trusted wall-clock instant for a management action. */
	now(): Date;
}

/** Composition-root dependencies for the managed-agent management router. */
export interface AgentServicesRouterDependencies
{
	/** Stores and reads services, revisions, and run history — see {@link AgentRevisionLifecycleRepository}. */
	readonly lifecycle: AgentRevisionLifecycleRepository;
	/** Returns a publication repository bound to this caller, so the audit row it appends names the administrator who published rather than the process. */
	publicationFor(caller: ManagementCaller): AgentServicePublicationRepository;
	/** App-owned managed run admission boundary used by run-now. */
	readonly runAdmission: ManagedRunAdmissionPort;
	/** Stores the recurring schedules behind the `/schedules` endpoints — see {@link AgentScheduleRepository}. */
	readonly schedules: AgentScheduleRepository;
	/** Resolves the authenticated caller from the request, or null when unauthenticated. */
	resolveCaller(request: Request): ManagementCaller | null;
	/** Server-owned management clock, replaceable only for deterministic tests. */
	readonly clock: ManagementClock;
	/** Structured redacting logger for otherwise fail-closed persistence failures. */
	readonly logger: Logger;
}
