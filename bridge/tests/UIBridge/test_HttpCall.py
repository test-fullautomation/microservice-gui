"""
Tests for REST calls the bridge makes for components (``ctx.http``).

``POST /api/http/call`` takes the service's address from Consul and calls
its HTTP API (``http_call_request`` and ``send_http`` in
``adapters/ui_bridge/fastapi_bridge.py``). The tests run a fake Consul
and a fake REST service on loopback ports.
"""

import json
import os
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from microservice_gui_bridge.adapters.ui_bridge import fastapi_bridge as fb  # noqa: E402
from microservice_gui_bridge.adapters.ui_bridge.fastapi_bridge import (  # noqa: E402
    FastAPIBridge,
    http_call_request,
    http_service_port,
    is_service_name,
)


class _Service(BaseHTTPRequestHandler):
    """A REST service: /echo answers what it got; the others one case each."""

    def log_message(self, *args):
        pass

    def _send(self, status, body, ctype="application/json", extra=()):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _any(self):
        path = urlsplit(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        if path.startswith("/echo"):
            self._send(200, json.dumps({
                "method": self.command, "path": self.path, "body": body,
                "headers": {k.lower(): v for k, v in self.headers.items()}}),
                extra=[("Set-Cookie", "session=secret"), ("X-Trace", "t1")])
        elif path == "/missing":
            self._send(404, json.dumps({"detail": "no such session"}))
        elif path == "/moved":
            self._send(302, "", ctype="text/plain", extra=[("Location", "http://example.invalid/steal")])
        elif path == "/text":
            self._send(200, "plain words", ctype="text/plain; charset=utf-8")
        elif path == "/bytes":
            self._send(200, b"\x00\xff\x10", ctype="application/octet-stream")
        elif path == "/notjson":
            self._send(200, "{not json", ctype="application/json")
        elif path == "/empty":
            self.send_response(204)
            self.end_headers()
        else:
            self._send(500, json.dumps({"detail": "unexpected " + path}))

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _any


def _serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def cluster():
    service = _serve(_Service)
    port = service.server_address[1]
    closed = _free_port()
    entries = {
        "session-manager": {"Address": "127.0.0.1", "Port": port, "Meta": {}},
        # gRPC on its own port, REST on Meta.http_port.
        "dual": {"Address": "127.0.0.1", "Port": 1, "Meta": {"http_port": str(port)}},
        "down": {"Address": "127.0.0.1", "Port": closed, "Meta": {}},
    }
    asked = []

    class _Consul(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            asked.append(self.path)
            name = urlsplit(self.path).path.rsplit("/", 1)[-1]
            entry = entries.get(name)
            data = json.dumps([{"Service": entry}] if entry else []).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    consul = _serve(_Consul)
    bridge = FastAPIBridge(host="localhost", port=1112)
    bridge._consul_url = "http://127.0.0.1:%d" % consul.server_address[1]
    client = TestClient(bridge._build_app() or bridge._app)
    yield client, asked, port
    service.shutdown()
    consul.shutdown()


def _call(client, **body):
    body.setdefault("consul_name", "session-manager")
    return client.post("/api/http/call", json=body).json()


class Test_RequestChecks:

    def test_a_plain_call(self):
        method, path, headers, rid = http_call_request("get", "/sessions/7")
        assert (method, path) == ("GET", "/sessions/7")
        assert headers["x-request-id"] == rid and len(rid) == 32

    def test_query_is_encoded(self):
        _, path, _, _ = http_call_request("GET", "/find", {"name": "a b&c", "n": 3, "none": None})
        assert path == "/find?name=a+b%26c&n=3&none="

    @pytest.mark.parametrize("method", ["HEAD", "OPTIONS", "TRACE", "CONNECT", "get x"])
    def test_other_methods_are_refused(self, method):
        with pytest.raises(ValueError, match="method"):
            http_call_request(method, "/")

    @pytest.mark.parametrize("path", [
        "sessions", "http://evil.example/x", "//evil.example", "/a?b=1", "/a#frag", "/a b", "/a\\b",
        "/../admin", "/a/./b", "/a/%2e%2e/b", "/a/%2E%2E", "/a%5c..%5cb", "/" + "x" * 2048,
    ])
    def test_paths_that_are_not_a_plain_path_are_refused(self, path):
        with pytest.raises(ValueError, match="path"):
            http_call_request("GET", path)

    def test_the_path_cannot_reach_another_host(self):
        # "//host" is refused above; "@" and ":" stay inside the path.
        _, path, _, _ = http_call_request("GET", "/user@host:80/x")
        assert path == "/user@host:80/x"

    @pytest.mark.parametrize("key", ["host", "cookie", "content-length", "transfer-encoding", "origin",
                                     "x-request-id", "x-mm-user", "proxy-authorization", "proxy-x", "sec-fetch-site"])
    def test_reserved_headers_are_refused(self, key):
        with pytest.raises(ValueError, match="reserved"):
            http_call_request("GET", "/", headers={key: "v"})

    @pytest.mark.parametrize("key", ["X-Upper", "with space", "a:b", ""])
    def test_header_names_are_lowercase_tokens(self, key):
        with pytest.raises(ValueError, match="header"):
            http_call_request("GET", "/", headers={key: "v"})

    def test_header_values_are_printable(self):
        with pytest.raises(ValueError, match="printable"):
            http_call_request("GET", "/", headers={"x-a": "line\r\nx-evil: 1"})

    def test_a_good_request_id_is_kept_a_bad_one_replaced(self):
        assert http_call_request("GET", "/", request_id="gui-42")[3] == "gui-42"
        assert http_call_request("GET", "/", request_id="bad id!")[3] != "bad id!"

    def test_limits(self):
        with pytest.raises(ValueError, match="query"):
            http_call_request("GET", "/", {str(i): i for i in range(fb.MAX_HTTP_QUERY + 1)})
        with pytest.raises(ValueError, match="headers"):
            http_call_request("GET", "/", headers={"x-%d" % i: "v" for i in range(fb.MAX_HTTP_HEADERS + 1)})

    @pytest.mark.parametrize("name, ok", [("session-manager", True), ("svc_1.v2", True), ("", False),
                                          ("a/b", False), ("a?b", False), ("../x", False), ("x" * 129, False)])
    def test_service_names(self, name, ok):
        assert is_service_name(name) is ok

    def test_http_port_from_meta(self):
        assert http_service_port(50051, {"http_port": "8090"}) == 8090
        assert http_service_port(50051, {"http_port": "x"}) == 50051
        assert http_service_port(50051, {"http_port": "70000"}) == 50051
        assert http_service_port(8090, {}) == 8090


class Test_Endpoint:

    def test_get_with_query_reaches_the_service_from_consul(self, cluster):
        client, asked, port = cluster
        d = _call(client, method="GET", path="/echo/sessions", query={"state": "open"}, request_id="gui-1")
        assert d["ok"] is True and d["status"] == 200 and d["type"] == "json"
        assert d["target"] == "127.0.0.1:%d" % port
        assert d["body"]["path"] == "/echo/sessions?state=open"
        assert d["body"]["headers"]["x-request-id"] == "gui-1" == d["request_id"]
        assert any(p.startswith("/v1/health/service/session-manager") for p in asked)

    def test_post_sends_json_and_caller_headers(self, cluster):
        client, _, _ = cluster
        d = _call(client, method="POST", path="/echo", body={"name": "run 1", "n": [1, 2]},
                  headers={"x-tenant": "lab-3"})
        assert d["ok"] is True
        assert json.loads(d["body"]["body"]) == {"name": "run 1", "n": [1, 2]}
        assert d["body"]["headers"]["content-type"] == "application/json"
        assert d["body"]["headers"]["x-tenant"] == "lab-3"

    def test_cookies_of_the_answer_stay_in_the_bridge(self, cluster):
        client, _, _ = cluster
        d = _call(client, path="/echo")
        assert "set-cookie" not in d["headers"] and d["headers"]["x-trace"] == "t1"

    def test_a_4xx_is_an_http_error_with_status_and_body(self, cluster):
        client, _, _ = cluster
        d = _call(client, path="/missing")
        assert d["ok"] is False and d["code"] == "HttpError" and d["status"] == 404
        assert d["body"] == {"detail": "no such session"} and "HTTP 404" in d["error"]

    def test_a_redirect_is_not_followed(self, cluster):
        client, _, _ = cluster
        d = _call(client, path="/moved")
        assert d["ok"] is False and d["status"] == 302
        assert d["headers"]["location"] == "http://example.invalid/steal"

    def test_text_bytes_empty_and_broken_json(self, cluster):
        client, _, _ = cluster
        assert (lambda d: (d["type"], d["body"]))(_call(client, path="/text")) == ("text", "plain words")
        assert (lambda d: (d["type"], d["body"]))(_call(client, path="/bytes")) == ("base64", "AP8Q")
        assert (lambda d: (d["status"], d["body"]))(_call(client, path="/empty")) == (204, "")
        assert (lambda d: (d["type"], d["body"]))(_call(client, path="/notjson")) == ("text", "{not json")

    def test_meta_http_port_is_used(self, cluster):
        client, _, port = cluster
        d = _call(client, consul_name="dual", path="/echo")
        assert d["ok"] is True and d["target"] == "127.0.0.1:%d" % port

    def test_a_service_not_in_consul(self, cluster):
        client, _, _ = cluster
        d = _call(client, consul_name="nobody", path="/echo")
        assert d["ok"] is False and d["code"] == "" and "not found in Consul" in d["error"]

    def test_a_service_that_is_down(self, cluster):
        client, _, _ = cluster
        d = _call(client, consul_name="down", path="/echo", timeout=2)
        assert d["ok"] is False and d["code"] == "" and "GET /echo" in d["error"]

    def test_bad_requests_are_refused_before_consul_is_asked(self, cluster):
        client, asked, _ = cluster
        n = len(asked)
        for body in ({"consul_name": "../v1/agent/self", "path": "/"},
                     {"path": "http://evil.example/"},
                     {"path": "/echo", "headers": {"host": "evil.example"}},
                     {"path": "/echo", "method": "TRACE"}):
            d = _call(client, **body)
            assert d["ok"] is False and d["code"] == "", body
        assert len(asked) == n

    def test_a_too_large_answer(self, cluster, monkeypatch):
        client, _, _ = cluster
        monkeypatch.setattr(fb, "MAX_HTTP_BODY", 10)
        d = _call(client, path="/echo")
        assert d["ok"] is False and "larger than" in d["error"]
