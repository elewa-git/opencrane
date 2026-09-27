import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";
import type { RequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { RoutineAuthority } from "../routine-authority";

/** Operations exposed by the authenticated routine HTTP boundary. */
export type RoutineHttpAuthority = Pick<RoutineAuthority, "create" | "read" | "revise" | "pause" | "resume" | "retire" | "runNow" | "list" | "firings" | "creationOptions" | "preview">;

/** Resolves a Principal from server-authenticated request state, never from request input. */
export type RoutineRequestPrincipalResolver = (request: Request) => RequestPrincipal | null;

/** Logging capability used only for sanitized unexpected failures. */
export type RoutineHttpLogger = Pick<Logger, "warn">;
