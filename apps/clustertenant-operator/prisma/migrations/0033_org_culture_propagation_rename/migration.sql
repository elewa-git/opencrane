-- Migration 0033: Rename the company-docs domain to org-culture-propagation.
--
-- A no-backwards-compatibility rename of the P4C personalisation domain
-- (originally created in 0009): company docs become "culture docs" and the
-- company→tenant "reconciliation" becomes "propagation". Every object is
-- renamed in place, so existing rows are preserved untouched. Object names are
-- brought in line with Prisma's deterministic naming for the new models so the
-- schema stays drift-free.

-- Enum: DocProposalStatus -> PropagationStatus (mapped values unchanged).
ALTER TYPE "DocProposalStatus" RENAME TO "PropagationStatus";

-- company_docs -> culture_docs
ALTER TABLE "company_docs" RENAME TO "culture_docs";
ALTER TABLE "culture_docs" RENAME CONSTRAINT "company_docs_pkey" TO "culture_docs_pkey";
ALTER INDEX "company_docs_name_key" RENAME TO "culture_docs_name_key";

-- company_doc_versions -> culture_doc_versions
ALTER TABLE "company_doc_versions" RENAME TO "culture_doc_versions";
ALTER TABLE "culture_doc_versions" RENAME COLUMN "company_doc_id" TO "culture_doc_id";
ALTER TABLE "culture_doc_versions" RENAME CONSTRAINT "company_doc_versions_pkey" TO "culture_doc_versions_pkey";
ALTER TABLE "culture_doc_versions" RENAME CONSTRAINT "company_doc_versions_company_doc_id_fkey" TO "culture_doc_versions_culture_doc_id_fkey";
ALTER INDEX "company_doc_versions_company_doc_id_version_key" RENAME TO "culture_doc_versions_culture_doc_id_version_key";
ALTER INDEX "company_doc_versions_company_doc_id_idx" RENAME TO "culture_doc_versions_culture_doc_id_idx";

-- tenant_workspace_docs -> tenant_culture_docs
ALTER TABLE "tenant_workspace_docs" RENAME TO "tenant_culture_docs";
ALTER TABLE "tenant_culture_docs" RENAME COLUMN "last_reconciled_version" TO "last_propagated_version";
ALTER TABLE "tenant_culture_docs" RENAME CONSTRAINT "tenant_workspace_docs_pkey" TO "tenant_culture_docs_pkey";
ALTER TABLE "tenant_culture_docs" RENAME CONSTRAINT "tenant_workspace_docs_tenant_fkey" TO "tenant_culture_docs_tenant_fkey";
ALTER INDEX "tenant_workspace_docs_tenant_doc_name_key" RENAME TO "tenant_culture_docs_tenant_doc_name_key";
ALTER INDEX "tenant_workspace_docs_tenant_idx" RENAME TO "tenant_culture_docs_tenant_idx";

-- doc_merge_proposals -> culture_propagation_proposals
ALTER TABLE "doc_merge_proposals" RENAME TO "culture_propagation_proposals";
ALTER TABLE "culture_propagation_proposals" RENAME CONSTRAINT "doc_merge_proposals_pkey" TO "culture_propagation_proposals_pkey";
ALTER TABLE "culture_propagation_proposals" RENAME CONSTRAINT "doc_merge_proposals_tenant_fkey" TO "culture_propagation_proposals_tenant_fkey";
ALTER INDEX "doc_merge_proposals_tenant_doc_name_target_version_key" RENAME TO "culture_propagation_proposals_tenant_doc_name_target_version_key";
ALTER INDEX "doc_merge_proposals_tenant_doc_name_idx" RENAME TO "culture_propagation_proposals_tenant_doc_name_idx";
ALTER INDEX "doc_merge_proposals_status_idx" RENAME TO "culture_propagation_proposals_status_idx";
