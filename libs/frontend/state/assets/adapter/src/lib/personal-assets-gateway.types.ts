import { InjectionToken } from "@angular/core";

/** Browser-safe metadata for one asset owned by the signed-in user. */
export interface PersonalAsset
{
	/** Stable asset identifier. */
	readonly id: string;
	/** Asset purpose. */
	readonly kind: "document" | "generated" | "skill" | "upload";
	/** Current non-terminal lifecycle state. */
	readonly state: "active" | "deletion_pending";
	/** Current revision identifier, if finalized. */
	readonly currentRevisionId: string | null;
	/** Current revision media type, if finalized. */
	readonly mediaType: string | null;
	/** Exact decimal byte count, if finalized. */
	readonly byteLength: string | null;
	/** Current revision indexing state, if finalized. */
	readonly indexState: "pending" | "indexed" | "failed" | "removal_pending" | "removed" | null;
	/** Asset creation time. */
	readonly createdAt: string;
	/** Most recent asset update time. */
	readonly updatedAt: string;
}

/** Read-only port for the signed-in user's personal asset catalogue. */
export interface PersonalAssetsGateway
{
	/** Lists the caller-owned assets in the host-selected ClusterTenant. */
	list(): Promise<readonly PersonalAsset[]>;
}

/** DI token for the owner-bound personal assets gateway. */
export const PERSONAL_ASSETS_GATEWAY: InjectionToken<PersonalAssetsGateway> = new InjectionToken<PersonalAssetsGateway>("OC_PERSONAL_ASSETS_GATEWAY");
