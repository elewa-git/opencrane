import type { Request } from "express";

/** Trusted request coordinates used to resolve the personal owner inside the transaction. */
export interface PersonalAgentToolsCaller
{
	/** Silo selected from the authenticated request host. */
	readonly siloId: string;
	/** External identity subject used by the existing personal-agent ownership relation. */
	readonly subjectId: string;
}

/** Resolves personal tool callers without accepting identity from the request body. */
export type PersonalAgentToolsCallerResolver = (request: Request) => PersonalAgentToolsCaller | null;

/** Replaces every tool assignment on the active personal revision. */
export interface PersonalAgentToolsCommand
{
	/** Active revision observed by the caller before editing. */
	readonly expectedActiveRevisionId: string;
	/** At most 32 unique immutable tool revisions; an empty list removes every assignment. */
	readonly toolRevisionIds: readonly string[];
}

/** Authoritative personal service revision and its canonical tool selection. */
export interface PersonalAgentToolsSelection
{
	readonly agentServiceId: string;
	readonly activeRevisionId: string;
	readonly toolRevisionIds: readonly string[];
}

/** Public transaction boundary for personal tool reads and replacements. */
export interface PersonalAgentToolsAuthority
{
	getTools(caller: PersonalAgentToolsCaller): Promise<PersonalAgentToolsSelection>;
	setTools(caller: PersonalAgentToolsCaller, command: PersonalAgentToolsCommand): Promise<PersonalAgentToolsSelection>;
}

/** Transaction-scoped persistence contract used by the owning unit of work. */
export interface PersonalAgentToolsRepository
{
	getTools(caller: PersonalAgentToolsCaller, now: Date): Promise<PersonalAgentToolsSelection>;
	setTools(caller: PersonalAgentToolsCaller, command: PersonalAgentToolsCommand, now: Date): Promise<PersonalAgentToolsSelection>;
}
