#!/usr/bin/env python3
"""Orchestrate the pinned Cognee memory provider qualification cases."""

import argparse
import json
from pathlib import Path

from provider_api import ProviderApi
from provider_identity_contract import prepare_identity, recover_identity
from provider_isolation_contract import prepare_isolation


SYNTHETIC_USER_EMAIL = "opencrane-memory-contract@example.com"
SYNTHETIC_USER_PASSWORD = "test-only-memory-contract-password"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("initial", "recovery"), required=True)
    parser.add_argument("--mode", choices=("acl-disabled", "acl-enabled"), required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--drop-proxy", default="drop-proxy:8091")
    return parser.parse_args()


def main() -> None:
    args = _arguments()
    api = ProviderApi(args.base_url)
    output_path = Path(args.output)
    state_path = Path(args.state)
    try:
        if args.mode == "acl-enabled":
            api.authenticate(
                SYNTHETIC_USER_EMAIL,
                SYNTHETIC_USER_PASSWORD,
                register=args.phase == "initial",
            )
        if args.phase == "initial":
            evidence = prepare_isolation(api, args.namespace, args.mode)
            if args.mode == "acl-enabled":
                evidence = prepare_identity(api, evidence, args.drop_proxy)
            state_path.write_text(
                json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
        else:
            if args.mode != "acl-enabled":
                raise AssertionError("Recovery phase is only valid for the ACL-enabled candidate")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            evidence = recover_identity(api, state)
    except Exception as failure:
        evidence = {
            "outcome": "fail",
            "phase": args.phase,
            "mode": args.mode,
            "failureType": type(failure).__name__,
            "message": str(failure),
        }
        output_path.write_text(
            json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        raise
    output_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
