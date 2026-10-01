import type { Router } from "express";
import type { PersonaOnboardingWorkflowPort } from "@opencrane/backend/agents/personal/personas";

/** The durable-onboarding HTTP routes and persona notifications, composed together. */
export interface UserOnboardingRouteComposition
{
	/** Owner-only durable routing-state API. */
	readonly router: Router;
	/** Persona lifecycle notifications: they move initial onboarding forward, and are accepted and ignored once onboarding is done. */
	readonly personaWorkflow: PersonaOnboardingWorkflowPort;
}
