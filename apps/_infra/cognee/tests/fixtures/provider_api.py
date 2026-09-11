#!/usr/bin/env python3
"""Small HTTP client for the pinned Cognee provider qualification test."""

import http.client
import json
import mimetypes
import uuid
from typing import Any
from urllib import error, request
from urllib.parse import urlencode


class ProviderResponseError(RuntimeError):
    """Report a provider response that does not satisfy the requested status."""

    def __init__(self, status: int, path: str, body: bytes):
        summary = body[:300].decode("utf-8", errors="replace")
        super().__init__(f"Provider returned HTTP {status} for {path}: {summary}")
        self.status = status


class ProviderApi:
    """Call the exact Cognee dataset, ingestion, search, and deletion routes under test."""

    def __init__(self, base_url: str, access_token: str | None = None):
        self.base_url = base_url.rstrip("/")
        self._access_token = access_token

    def _request(
        self,
        method: str,
        path: str,
        payload: bytes | None = None,
        content_type: str | None = None,
        timeout: int = 300,
        accepted: tuple[int, ...] = (200,),
    ) -> bytes:
        headers = {"accept": "application/json"}
        if self._access_token is not None:
            headers["authorization"] = f"Bearer {self._access_token}"
        if content_type is not None:
            headers["content-type"] = content_type
        command = request.Request(
            f"{self.base_url}{path}", data=payload, headers=headers, method=method
        )
        try:
            with request.urlopen(command, timeout=timeout) as response:
                body = response.read()
                status = response.status
        except error.HTTPError as failure:
            body = failure.read()
            status = failure.code
        if status not in accepted:
            raise ProviderResponseError(status, path, body)
        return body

    def authenticate(self, email: str, password: str, register: bool) -> None:
        """Create the synthetic user when requested, then retain its bearer only in memory."""
        if register:
            self.json(
                "POST",
                "/api/v1/auth/register",
                {"email": email, "password": password},
                accepted=(201,),
            )
        payload = urlencode({"username": email, "password": password}).encode("utf-8")
        body = self._request(
            "POST",
            "/api/v1/auth/login",
            payload,
            "application/x-www-form-urlencoded",
        )
        response = json.loads(body)
        access_token = response.get("access_token") if isinstance(response, dict) else None
        if not isinstance(access_token, str) or not access_token:
            raise AssertionError("Provider login did not return an access token")
        self._access_token = access_token

    def json(
        self,
        method: str,
        path: str,
        value: Any | None = None,
        timeout: int = 300,
        accepted: tuple[int, ...] = (200,),
    ) -> Any:
        payload = None
        content_type = None
        if value is not None:
            payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
            content_type = "application/json"
        body = self._request(method, path, payload, content_type, timeout, accepted)
        return None if not body else json.loads(body)

    def create_dataset(self, name: str) -> dict[str, Any]:
        value = self.json("POST", "/api/v1/datasets", {"name": name})
        if not isinstance(value, dict) or not isinstance(value.get("id"), str):
            raise AssertionError("Dataset creation did not return an id")
        return value

    def list_data(self, dataset_id: str) -> list[dict[str, Any]]:
        value = self.json("GET", f"/api/v1/datasets/{dataset_id}/data")
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise AssertionError("Dataset data response is not a list of objects")
        return value

    def raw(self, dataset_id: str, document_id: str) -> bytes:
        return self._request(
            "GET", f"/api/v1/datasets/{dataset_id}/data/{document_id}/raw"
        )

    def assert_raw_absent(self, dataset_id: str, document_id: str) -> None:
        try:
            self._request("GET", f"/api/v1/datasets/{dataset_id}/data/{document_id}/raw")
        except ProviderResponseError as failure:
            if failure.status == 404:
                return
            raise AssertionError(
                f"Raw source absence returned HTTP {failure.status} instead of 404"
            ) from failure
        raise AssertionError("Raw source remains available after deletion")

    def add(self, dataset_id: str, filename: str, content: bytes, base_url: str | None = None) -> Any:
        boundary = f"opencrane-memory-contract-{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(filename)[0] or "text/plain"
        pieces = [
            f"--{boundary}\r\n".encode(),
            (
                f'Content-Disposition: form-data; name="data"; filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode(),
            content,
            b"\r\n",
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="datasetId"\r\n\r\n',
            dataset_id.encode(),
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        payload = b"".join(pieces)
        endpoint = self if base_url is None else ProviderApi(base_url, self._access_token)
        body = endpoint._request(
            "POST",
            "/api/v1/add",
            payload,
            f"multipart/form-data; boundary={boundary}",
        )
        return None if not body else json.loads(body)

    def add_and_expect_dropped_response(
        self, proxy_host: str, proxy_port: int, dataset_id: str, filename: str, content: bytes
    ) -> None:
        boundary = f"opencrane-memory-contract-{uuid.uuid4().hex}"
        payload = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="data"; filename="{filename}"\r\n'
                    "Content-Type: text/plain\r\n\r\n"
                ).encode(),
                content,
                b"\r\n",
                f"--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="datasetId"\r\n\r\n',
                dataset_id.encode(),
                b"\r\n",
                f"--{boundary}--\r\n".encode(),
            ]
        )
        connection = http.client.HTTPConnection(proxy_host, proxy_port, timeout=310)
        headers = {
            "accept": "application/json",
            "content-type": f"multipart/form-data; boundary={boundary}",
            "content-length": str(len(payload)),
        }
        if self._access_token is not None:
            headers["authorization"] = f"Bearer {self._access_token}"
        try:
            connection.request(
                "POST",
                "/api/v1/add",
                body=payload,
                headers=headers,
            )
            response = connection.getresponse()
            response.read()
        except (http.client.RemoteDisconnected, ConnectionResetError):
            return
        finally:
            connection.close()
        raise AssertionError("Commit-then-drop proxy returned a response to the caller")

    def cognify(self, dataset_id: str) -> Any:
        return self.json(
            "POST",
            "/api/v1/cognify",
            {"dataset_ids": [dataset_id], "run_in_background": False, "chunk_size": 128},
            timeout=600,
        )

    def search(self, dataset_id: str, query_text: str, top_k: int = 10) -> list[dict[str, Any]]:
        value = self.json(
            "POST",
            "/api/v1/search",
            {
                "search_type": "CHUNKS",
                "dataset_ids": [dataset_id],
                "query": query_text,
                "top_k": top_k,
            },
            timeout=300,
        )
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise AssertionError("CHUNKS response is not a list of objects")
        return value

    def delete(self, dataset_id: str, document_id: str) -> None:
        self._request(
            "DELETE",
            f"/api/v1/datasets/{dataset_id}/data/{document_id}",
            accepted=(200, 204),
        )

    def graph(self, dataset_id: str) -> Any:
        return self.json("GET", f"/api/v1/datasets/{dataset_id}/graph")
