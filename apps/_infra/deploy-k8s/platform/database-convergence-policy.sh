#!/usr/bin/env bash
# Maps every (state, event) pair for live database convergence onto one outcome. It is pure: callers own
# classification I/O and execute the returned lifecycle outcome.

database_convergence_state_is_valid()
{
  case "$1" in
    current) return 0 ;;
    completed) return 0 ;;
    source) return 0 ;;
    incompatible) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_database_convergence_outcome()
{
  local event="$1"
  local state="$2"
  if ! database_convergence_state_is_valid "$state"; then
    printf 'database convergence policy: unknown state %q\n' "$state" >&2
    return 1
  fi
  case "${event}:${state}" in
    live_transition:current) printf '%s\n' reconcile_without_fence ;;
    live_transition:completed) printf '%s\n' reconcile_without_fence ;;
    live_transition:source) printf '%s\n' migrate_source ;;
    live_transition:incompatible) printf '%s\n' reject_before_fence ;;
    recovered_transition:current) printf '%s\n' reconcile_while_fenced ;;
    recovered_transition:completed) printf '%s\n' reconcile_while_fenced ;;
    recovered_transition:source) printf '%s\n' migrate_recovered_source ;;
    recovered_transition:incompatible) printf '%s\n' reject_keep_fence ;;
    failed_transition:current) printf '%s\n' keep_fence ;;
    failed_transition:completed) printf '%s\n' keep_fence ;;
    failed_transition:source) printf '%s\n' rollback_source ;;
    failed_transition:incompatible) printf '%s\n' keep_fence ;;
    *)
      printf 'database convergence policy: unknown event %q\n' "$event" >&2
      return 1
      ;;
  esac
}
