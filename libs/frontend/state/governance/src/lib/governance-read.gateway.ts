import { InjectionToken, type Signal } from "@angular/core";

import type { GovernanceReadGateway } from "./governance-read.types";

/** App composition binds the protected read adapter without giving screens a write API. */
export const GOVERNANCE_READ_GATEWAY = new InjectionToken<GovernanceReadGateway>("GOVERNANCE_READ_GATEWAY");

/**
 * App-supplied authenticated reader identity. Null closes reads; a changed identity invalidates
 * retained responses. This signal identifies a reader and never substitutes for server permission.
 */
export const GOVERNANCE_READER_IDENTITY = new InjectionToken<Signal<string | null>>("GOVERNANCE_READER_IDENTITY");
