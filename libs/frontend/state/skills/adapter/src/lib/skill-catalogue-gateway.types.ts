import { InjectionToken } from "@angular/core";

/** Browser-safe summary of a governed skill. */
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

/** Read-only port for the host-silo governed skill catalogue. */
export interface SkillCatalogueGateway
{
	/** Lists safe governed skills from the host-selected silo. */
	list(): Promise<readonly GovernedSkill[]>;
}

/** DI token for the governed skill catalogue. */
export const SKILL_CATALOGUE_GATEWAY: InjectionToken<SkillCatalogueGateway> = new InjectionToken<SkillCatalogueGateway>("OC_SKILL_CATALOGUE_GATEWAY");
