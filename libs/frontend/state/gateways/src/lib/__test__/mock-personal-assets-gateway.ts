import type { PersonalAsset, PersonalAssetsGateway } from "@opencrane/state/assets/adapter";

/** In-memory personal asset gateway for UI-state tests. */
export class MockPersonalAssetsGateway implements PersonalAssetsGateway
{
	/** Configurable owner-bound asset fixture. */
	public assets: readonly PersonalAsset[] = [];

	/** @inheritdoc */
	public async list(): Promise<readonly PersonalAsset[]>
	{
		return this.assets;
	}
}
