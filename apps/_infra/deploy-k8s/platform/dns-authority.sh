#!/usr/bin/env bash

# Accepts a name when it or one of its parent domains publishes an SOA record, because a parent zone can serve the requested record subtree.
# It stops before querying a single-label TLD so public TLD authority cannot qualify an unserved base domain.
# It returns 2 for an unsupported inspector and 1 when neither the name nor an eligible parent publishes an SOA record.
dns_authority_resolves()
{
  local candidate="$1"
  local inspector="$2"
  local response

  while [[ "$candidate" == *.* ]]; do
    response=""
    case "$inspector" in
      dig)
        response="$(dig +short SOA "$candidate" 2>/dev/null || true)"
        ;;
      host)
        if ! response="$(host -t SOA "$candidate" 2>/dev/null)"; then response=""; fi
        ;;
      *)
        return 2
        ;;
    esac

    if [[ -n "$response" ]]; then return 0; fi
    candidate="${candidate#*.}"
  done

  return 1
}
