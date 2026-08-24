import { createDevelopmentSeedProcessEnvironment } from "./process-environments.mjs";

/** Builds the seed command with the private signing key admitted to that process alone. */
export function createDevelopmentSeedCommand(applicationEnvironment)
{
	return {
		name: "development-seed",
		command: "npm",
		arguments: ["run", "db:seed-tier2", "-w", "@opencrane/server"],
		environment: createDevelopmentSeedProcessEnvironment(applicationEnvironment)
	};
}
