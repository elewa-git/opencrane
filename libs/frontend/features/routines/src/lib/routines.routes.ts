import type { Routes } from "@angular/router";

import { RoutineShellComponent } from "./components/routine-shell/routine-shell.component";
import { RoutineCreateRouteComponent } from "./routes/routine-create-route.component";
import { RoutineDetailRouteComponent } from "./routes/routine-detail-route.component";
import { RoutineListRouteComponent } from "./routes/routine-list-route.component";

/** Lazy authenticated routine routes mounted by the OpenCrane browser app. */
export const ROUTINE_ROUTES: Routes = [{ path: "", component: RoutineShellComponent, children: [{ path: "", pathMatch: "full", component: RoutineListRouteComponent }, { path: "new", component: RoutineCreateRouteComponent }, { path: ":routineId", component: RoutineDetailRouteComponent }] }];
