#!/usr/bin/env bash

# Chooses the reviewed patch resolver only when the operator approves the 0.9.2 to 0.9.3 pair.
# Every other request stays on the generic transition policy or fails when it misuses the approval flag.
select_database_transition_resolver()
{
  local generic_resolver="$1"
  local patch_resolver="$2"
  local release_version="$3"
  local from_release_version="$4"
  local patch_approved="$5"

  if [[ "$patch_approved" != "1" ]]; then
    printf '%s\n' "$generic_resolver"
    return
  fi
  if [[ "$release_version" != "0.9.3" || "$from_release_version" != "0.9.2" ]]; then
    printf '%s\n' "--approve-0.9.2-to-0.9.3-database-transition requires --release-version 0.9.3 and --from-release-version 0.9.2." >&2
    return 1
  fi
  if [[ ! -f "$patch_resolver" ]]; then
    printf '%s\n' "The reviewed 0.9.3 database transition resolver is missing." >&2
    return 1
  fi
  printf '%s\n' "$patch_resolver"
}
