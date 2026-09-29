import { InjectionToken, type Signal } from "@angular/core";

import type { RoutineGateway } from "./routine-gateway.types";

/** App composition binds the authenticated routine adapter through this port. */
export const ROUTINE_GATEWAY = new InjectionToken<RoutineGateway>("ROUTINE_GATEWAY");

/** The current signed-in subject and silo identity; null closes routine reads and commands. */
export const ROUTINE_SESSION = new InjectionToken<Signal<string | null>>("ROUTINE_SESSION");
