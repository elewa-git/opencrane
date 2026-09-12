#!/usr/bin/env python3
"""Run the isolated Cognee 1.5.4 provider semantic qualification."""

import argparse
import json
import sys
from pathlib import Path

FIXTURE_DIRECTORY = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FIXTURE_DIRECTORY))

from provider_api import ProviderApi  # noqa: E402
from v1_5_4.provider_identity_contract import prepare_identity, recover_identity  # noqa: E402
from v1_5_4.provider_isolation_contract import prepare_isolation  # noqa: E402


SYNTHETIC_USER_EMAIL = "opencrane-memory-contract-1-5-4@example.com"
SYNTHETIC_USER_PASSWORD = "test-only-memory-contract-1-5-4-password"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--phase", choices=("initial", "recovery", "deletion-restart"), required=True
    )
    parser.add_argument("--mode", choices=("acl-disabled", "acl-enabled"), required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--base-url", default="http://cognee:8000")
    parser.add_argument("--drop-proxy", default="drop-proxy:8091")
    return parser.parse_args()


def _deletion_restart_result(
    validated_evidence: dict, deletion_recovery: dict
) -> dict:
    return {**validated_evidence, "deletionRecovery": deletion_recovery}


def _failure_result(
    validated_evidence: dict, phase: str, mode: str, failure: Exception
) -> dict:
    evidence = {
        **validated_evidence,
        "outcome": "fail",
        "phase": phase,
        "mode": mode,
        "failureType": type(failure).__name__,
        "message": str(failure),
    }
    failure_evidence = getattr(failure, "evidence", None)
    if isinstance(failure_evidence, dict):
        evidence["deletionRecovery"] = failure_evidence
    return evidence


def main() -> None:
    args = _arguments()
    api = ProviderApi(args.base_url)
    output_path = Path(args.output)
    state_path = Path(args.state)
    validated_evidence = {}
    try:
        if args.phase != "initial":
            if args.mode != "acl-enabled":
                raise AssertionError(
                    "Recovery phases are only valid for the authenticated candidate"
                )
            validated_evidence = json.loads(state_path.read_text(encoding="utf-8"))
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
        elif args.phase == "recovery":
            evidence = recover_identity(api, validated_evidence)
            state_path.write_text(
                json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
        else:
            from v1_5_4.provider_deletion_contract import verify_deletion_failure_after_restart

            deletion_recovery = verify_deletion_failure_after_restart(
                api, validated_evidence["deletionFaults"]
            )
            evidence = _deletion_restart_result(validated_evidence, deletion_recovery)
    except Exception as failure:
        evidence = _failure_result(validated_evidence, args.phase, args.mode, failure)
        output_path.write_text(
            json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        raise
    output_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
