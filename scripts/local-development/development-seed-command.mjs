import { createDevelopmentSeedProcessEnvironment } from "./process-environments.mjs";

export function createDevelopmentSeedCommand(applicationEnvironment)
{
	return {
		name: "development-seed",
		command: "npm",
		arguments: ["run", "db:seed-tier2", "-w", "@opencrane/server"],
		environment: createDevelopmentSeedProcessEnvironment(applicationEnvironment)
	};
}
