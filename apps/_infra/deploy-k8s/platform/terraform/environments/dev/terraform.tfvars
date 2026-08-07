# -----------------------------------------------------------------------------
# Dev environment values. The only required value is project_id — everything else
# has a sensible default (see ../../variables.tf). deploy.sh overwrites this file;
# for a manual apply, copy terraform.tfvars.example and set your project.
# -----------------------------------------------------------------------------

project_id = "opencrane-dev"
region     = "europe-west1"

cluster_name = "opencrane-dev-cluster"
