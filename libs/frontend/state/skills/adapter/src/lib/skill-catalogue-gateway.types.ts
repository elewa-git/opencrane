import { InjectionToken } from "@angular/core";

/** What the browser is told about one governed skill; the skill's own content stays server-side. */
export interface GovernedSkill
{
	/** Stable skill identifier. */
	readonly id: string;
	/** Skill display name. */
	readonly name: string;
	/** Browser-safe description. */
	readonly description: string;
	/** Current logical lifecycle. */
	readonly state: "active" | "retired";
	/** Selected revision identifier. */
	readonly currentRevisionId: string | null;
	/** Selected revision lifecycle. */
	readonly currentRevisionState: "draft" | "review" | "published" | "rejected" | "revoked" | null;
	/** Creation time. */
	readonly createdAt: string;
	/** Update time. */
	readonly updatedAt: string;
}

/**
 * Reads the skills available in the host's silo. Read-only — nothing here changes anything.
 *
 * Bound to OpenCraneSkillCatalogueGateway in the app's providers, and to
 * MockSkillCatalogueGateway in UI-state tests, both at {@link SKILL_CATALOGUE_GATEWAY}.
 *
 * @see GovernedSkill
 */
export interface SkillCatalogueGateway
{
	/** Lists safe governed skills from the host-selected silo. */
	list(): Promise<readonly GovernedSkill[]>;
}

/** DI token for the governed skill catalogue. */
export const SKILL_CATALOGUE_GATEWAY: InjectionToken<SkillCatalogueGateway> = new InjectionToken<SkillCatalogueGateway>("OC_SKILL_CATALOGUE_GATEWAY");
