import { Routes } from "@angular/router";

import { MembersRouteComponent } from "./members/members-route.component";

/** Member destinations composed beneath the app-owned Settings mount. */
export const SETTINGS_MEMBER_ROUTES: Routes = [{ path: "members", component: MembersRouteComponent }];
