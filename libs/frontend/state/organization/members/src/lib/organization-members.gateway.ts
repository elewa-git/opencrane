import { InjectionToken } from "@angular/core";

import type { OrganizationMembersGateway } from "./organization-members-gateway.types";

/** App-level binding for the concrete signed-in organization-members adapter. */
export const ORGANIZATION_MEMBERS_GATEWAY = new InjectionToken<OrganizationMembersGateway>("ORGANIZATION_MEMBERS_GATEWAY");
