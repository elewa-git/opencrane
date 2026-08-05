import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { AgentServicePublicationRepository } from "./agent-publication.types.js";
import type { AgentRevisionLifecycleRepository, ManagedRunAdmissionPort } from "./agent-revision-lifecycle.types.js";
import type { AgentScheduleRepository } from "./agent-schedule.types.js";
import type { ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/** Authenticated management caller resolved by the app from the browser session. */
export interface ManagementCaller
{
	/** Stable IdP subject of the caller. */
	readonly subjectId: string;
	/** Silo the caller is operating within. */
	readonly siloId: string;
	/** Whether the caller holds the organisation-admin role required to mutate definitions. */
	readonly isOrgAdmin: boolean;
}

/** Server-owned clock injected for deterministic management-time instants. */
export interface ManagementClock
{
	/** Returns the trusted wall-clock instant for a management action. */
	now(): Date;
}

/** Composition-root dependencies for the managed-agent management router. */
export interface AgentServicesRouterDependencies
{
	/** Atomic definition-plane persistence boundary. */
	readonly lifecycle: AgentRevisionLifecycleRepository;
	/** Builds a caller-attributed publication boundary so the publish audit records the real actor. */
	publicationFor(caller: ManagementCaller): AgentServicePublicationRepository;
	/** App-owned managed run admission boundary used by run-now. */
	readonly runAdmission: ManagedRunAdmissionPort;
	/** Silo-scoped schedule persistence boundary backing the schedule-management surface. */
	readonly schedules: AgentScheduleRepository;
	/**
	 * Grant-compiler-backed resolver used to validate, at attach time, that a caller administers every
	 * scope they attach — a stored attachment then grants nothing beyond the caller's effective access.
	 */
	readonly scopeGrantResolver: ScopeGrantResolver;
	/** Resolves the authenticated caller and role from the request, or null when unauthenticated. */
	resolveCaller(request: Request): ManagementCaller | null;
	/** Server-owned management clock, replaceable only for deterministic tests. */
	readonly clock: ManagementClock;
	/** Structured redacting logger for otherwise fail-closed persistence failures. */
	readonly logger: Logger;
}
