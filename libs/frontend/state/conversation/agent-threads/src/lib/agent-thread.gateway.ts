import { InjectionToken } from "@angular/core";

import type { AgentThreadGateway } from "./agent-thread.types.js";

/** Dependency-injection port for authorized Agent-thread reads and commands. */
export const AGENT_THREAD_GATEWAY = new InjectionToken<AgentThreadGateway>("AGENT_THREAD_GATEWAY");
