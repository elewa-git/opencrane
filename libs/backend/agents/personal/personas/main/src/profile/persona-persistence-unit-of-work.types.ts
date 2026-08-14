import type { PersonaAuthorityRepository } from "../approval/persona-authority.types";
import type { PersonaDraftFromInterviewRepository } from "../drafting/persona-draft-authority.types";
import type { PersonaInterviewQuestionReader, PersonaInterviewRepository } from "../interview/persona-interview-authority.types";
import type { PersonaOnboardingRepository } from "./persona-onboarding-authority.types";
import type { PersonaOnboardingStatusRepository } from "./persona-onboarding-status.types";

/**
 * One object that satisfies every persona persistence port at once.
 *
 * The composition root builds a single implementation and hands the same instance to the router as its
 * `onboarding`, `interviews`, `questions`, `drafts`, `approval` and `status` dependencies. Each method
 * opens its own transaction at Prisma's `Serializable` isolation level and creates the repositories it
 * needs inside that transaction, so the router only ever holds ports and never a live transaction.
 *
 * Extending all six ports is deliberate: it keeps the transaction decision in one class instead of
 * letting each use case start its own, which is what guarantees that a step's checks and its write
 * share a transaction. Every conflict outcome in this package depends on that isolation level being
 * `Serializable`; a weaker level would let two writers both pass their checks.
 *
 * Called by: nothing calls this type directly. It is implemented by
 * `PrismaPersonaPersistenceUnitOfWork` and consumed as the narrower ports it extends.
 *
 * @see PrismaPersonaPersistenceUnitOfWork
 * @see PersonaOnboardingRouterDependencies
 */
export interface PersonaPersistenceUnitOfWork extends PersonaAuthorityRepository, PersonaDraftFromInterviewRepository, PersonaInterviewQuestionReader, PersonaInterviewRepository, PersonaOnboardingRepository, PersonaOnboardingStatusRepository
{
}
