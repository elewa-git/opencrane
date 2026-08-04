import type { PersonaAuthorityRepository } from "../approval/persona-authority.types.js";
import type { PersonaDraftFromInterviewRepository } from "../drafting/persona-draft-authority.types.js";
import type { PersonaInterviewQuestionReader, PersonaInterviewRepository } from "../interview/persona-interview-authority.types.js";
import type { PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";
import type { PersonaOnboardingStatusRepository } from "./persona-onboarding-status.types.js";

/** Atomic persona-owned Serializable transaction seam exposed through lifecycle-specific ports. */
export interface PersonaPersistenceUnitOfWork extends PersonaAuthorityRepository, PersonaDraftFromInterviewRepository, PersonaInterviewQuestionReader, PersonaInterviewRepository, PersonaOnboardingRepository, PersonaOnboardingStatusRepository
{
}
