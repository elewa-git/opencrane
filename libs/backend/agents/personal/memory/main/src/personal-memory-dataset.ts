import type { PersonalMemoryDatasetRepository, ProvisionPersonalMemoryDatasetCommand, ProvisionPersonalMemoryDatasetResult } from "./memory-catalog.types.js";

/** Registers a gateway-confirmed Personal dataset under the one verified user scope. */
export async function __ProvisionPersonalMemoryDataset(repository: PersonalMemoryDatasetRepository, command: ProvisionPersonalMemoryDatasetCommand): Promise<ProvisionPersonalMemoryDatasetResult>
{
	// 1. Reject caller-shaped or incomplete coordinates before they can create a durable catalog scope.
	if (!__IsValidPersonalMemoryDatasetProvisionCommand(command)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Register the gateway-minted dataset atomically; the repository refuses a changed binding.
	const result = await repository.provisionPersonalDatasetAtomically(command);

	// 3. Surface repeat delivery as success without permitting an alternate dataset for the same person.
	if (result.status === "provisioned") return { outcome: "provisioned", idempotent: false };
	if (result.status === "idempotent") return { outcome: "provisioned", idempotent: true };
	return { outcome: "denied", reason: result.status };
}

/** Validate that a provision request names one nonblank verified personal scope and gateway dataset. */
export function __IsValidPersonalMemoryDatasetProvisionCommand(command: ProvisionPersonalMemoryDatasetCommand): boolean
{
	return command.siloId.trim().length > 0 && command.organizationId.trim().length > 0
		&& command.subjectId.trim().length > 0 && command.cogneeDatasetId.trim().length > 0
		&& command.createdBy === command.subjectId;
}
