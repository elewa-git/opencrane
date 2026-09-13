#!/usr/bin/env python3
"""Combine the provider contract's independently written evidence into one receipt."""

import argparse
import json
from pathlib import Path


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--image-inspect", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--negative", required=True)
    parser.add_argument("--positive-initial", required=True)
    parser.add_argument("--positive", required=True)
    parser.add_argument("--stub-log", required=True)
    parser.add_argument("--drop-log", required=True)
    parser.add_argument("--expected-drop-path", action="append", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--failure-status", type=int)
    parser.add_argument("--failed-case")
    return parser.parse_args()


def _read_json(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _read_json_lines(path: str) -> list[dict]:
    source = Path(path)
    if not source.exists():
        return []
    values = []
    for line_number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), start=1):
        if not line:
            continue
        try:
            values.append(json.loads(line))
        except json.JSONDecodeError:
            values.append({"outcome": "invalid-json-line", "lineNumber": line_number})
    return values


def _optional_json(path: str):
    source = Path(path)
    if not source.exists():
        return None
    try:
        return _read_json(path)
    except json.JSONDecodeError:
        return {"outcome": "invalid-json"}


def _validate_commit_then_drop(records: list[dict], expected_paths: list[str]) -> None:
    if not expected_paths or len(set(expected_paths)) != len(expected_paths):
        raise AssertionError("Commit-then-drop expectation must name unique recovery boundaries")
    if len(records) != len(expected_paths):
        raise AssertionError("Commit-then-drop proxy did not record both recovery boundaries")
    actual_paths = []
    for record in records:
        if set(record) != {"method", "path", "upstreamStatus", "responseDropped"}:
            raise AssertionError("Commit-then-drop evidence contains an unsafe or incomplete field set")
        if (
            record["method"] != "POST"
            or record["responseDropped"] is not True
            or not isinstance(record["upstreamStatus"], int)
            or not 200 <= record["upstreamStatus"] < 300
            or not isinstance(record["path"], str)
        ):
            raise AssertionError("Commit-then-drop evidence did not prove a completed dropped response")
        actual_paths.append(record["path"])
    if sorted(actual_paths) != sorted(expected_paths):
        raise AssertionError("Commit-then-drop evidence did not identify every expected recovery boundary")


def main() -> None:
    args = _arguments()
    if args.failure_status is not None:
        receipt = {
            "outcome": "fail",
            "failedCase": args.failed_case,
            "exitStatus": args.failure_status,
            "image": {
                "requestedReference": args.image,
                "inspection": _optional_json(args.image_inspect),
            },
            "source": _optional_json(args.source),
            "negativeControl": _optional_json(args.negative),
            "qualifiedCandidateInitial": _optional_json(args.positive_initial),
            "qualifiedCandidate": _optional_json(args.positive),
            "stubRequests": _read_json_lines(args.stub_log),
            "commitThenDrop": _read_json_lines(args.drop_log),
        }
        Path(args.output).write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"CASE {args.failed_case} FAIL status={args.failure_status}")
        return
    image_inspect = _read_json(args.image_inspect)
    if not isinstance(image_inspect, list) or len(image_inspect) != 1:
        raise AssertionError("Docker image inspection did not return exactly one image")
    image = image_inspect[0]
    receipt = {
        "outcome": "pass",
        "image": {
            "requestedReference": args.image,
            "id": image.get("Id"),
            "repoDigests": image.get("RepoDigests", []),
        },
        "source": _read_json(args.source),
        "negativeControl": _read_json(args.negative),
        "qualifiedCandidateInitial": _read_json(args.positive_initial),
        "qualifiedCandidate": _read_json(args.positive),
        "stubRequests": _read_json_lines(args.stub_log),
        "commitThenDrop": _read_json_lines(args.drop_log),
    }
    _validate_commit_then_drop(receipt["commitThenDrop"], args.expected_drop_path)
    Path(args.output).write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print("CASE machine_readable_evidence_receipt PASS")


if __name__ == "__main__":
    main()
