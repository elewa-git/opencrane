#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/dns-authority.sh"

dig()
{
  case "${3:-}" in
    opencrane.ai) printf 'ns-cloud-b1.googledomains.com. hostmaster.google.com. 1 21600 3600 259200 300\n' ;;
  esac
}

dns_authority_resolves dev.opencrane.ai dig
dns_authority_resolves opencrane.ai dig

dig()
{
  case "${3:-}" in
    isolated.example.test) printf 'ns.example.test. hostmaster.example.test. 1 2 3 4 5\n' ;;
  esac
}

dns_authority_resolves isolated.example.test dig

dig()
{
  [[ "${3:-}" == "ai" ]] && printf 'tld.example. hostmaster.example. 1 2 3 4 5\n'
}

if dns_authority_resolves missing.opencrane.ai dig; then
  echo "a top-level zone incorrectly qualified an unserved base domain" >&2
  exit 1
fi

host()
{
  [[ "${3:-}" == "opencrane.ai" ]] || return 1
  printf 'opencrane.ai has SOA record ns-cloud-b1.googledomains.com. hostmaster.google.com.\n'
}

dns_authority_resolves dev.opencrane.ai host

echo "DNS authority contract: PASS"
