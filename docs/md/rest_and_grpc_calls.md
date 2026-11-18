# Calling REST and gRPC services from a Bench component

A Bench component (or a plugin that a service delivers) runs in a
sandboxed frame without network access. It reaches services only through
its `ctx`:

| Call | Capability | Reaches |
|---|---|---|
| `ctx.call(method, args, opts)` | `grpc.call` | a gRPC service |
| `ctx.http(method, path, opts)` | `http.call` | a REST service (FastAPI and the like) |

The bridge makes both calls and looks up the service's address in Consul:

```
frame → ctx.http / ctx.call → GUI shell (checks capability and binding)
      → bridge (/api/http/call, /api/grpc/call) → address from Consul → service
```

So:

- **No address in the GUI.** You never write a host or port; the service
  only has to be registered in Consul and passing its health check.
- **No CORS setting** in the service: the bridge calls it, not the browser.
- **No change to the frame security rules.** Frames keep
  `connect-src 'none'`. Do not open it to reach a service directly: that
  gives every component and plugin the network, and skips the checks
  below.

`ctx.http` needs shell 2.4 or later (`"shell": "^2.4"`).

## 1. Choose your setup

### A. One service, REST only

The service registers its REST port in Consul.

```json
{
  "requires": { "shell": "^2.4", "capabilities": ["http.call"] },
  "binds": { "consul": "@self" }
}
```

### B. One service serving REST and gRPC

Register the **gRPC port** as the service's Consul port and the REST port
as `Meta.http_port`:

```
Port: 50051                    ← gRPC (ctx.call)
Meta: { "http_port": "8090" }  ← REST (ctx.http)
```

If both are served on the same port, leave `http_port` out.

```json
{
  "requires": { "shell": "^2.4", "capabilities": ["grpc.call", "http.call"] },
  "binds": { "consul": "@self", "grpc": "session.v1.SessionManager" }
}
```

### C. Two services

The component binds to one service and lists the other in `binds.uses`:

```json
{
  "requires": { "shell": "^2.4", "capabilities": ["grpc.call", "http.call"] },
  "binds": { "consul": "power-supply", "grpc": "power.v1.PowerSupply", "uses": ["session-manager"] }
}
```

Calls to the other service carry its Consul name as a prefix (see below).

`binds.consul: "@self"` means the service whose `Meta.gui` names this
component's folder. Otherwise write its Consul name.

## 2. Write the component

`component.json`:

```json
{
  "component": "session.sessions",
  "version": "1.0.0",
  "layer": "session",
  "title": "Sessions",
  "requires": { "shell": "^2.4", "capabilities": ["http.call"] },
  "binds": { "consul": "@self" },
  "tiles": [
    { "id": "list", "size": "2x2", "kind": "frame", "title": "Sessions", "entry": "panel.html" }
  ],
  "renderer": "html"
}
```

`panel.js`, loaded by `panel.html`:

```js
const ctx = window.endo.ctx;

async function load() {
  try {
    const r = await ctx.http('GET', '/sessions', { query: { state: 'open' } });
    render(r.body);                      // r.type === 'json': r.body is parsed
  } catch (e) {
    if (e.code === 'HttpError') show('HTTP ' + e.status + ': ' + (e.body && e.body.detail));
    else show(e.message);
  }
}

async function create(name) {
  await ctx.http('POST', '/sessions', { body: { name }, timeout: 5000 });
  load();
}

load();
window.endo.on('resume', load);          // reload when the tile is shown again
```

Mixing both kinds of call (setups B and C):

```js
await ctx.call('SetVoltage', { volts: 12 });                                   // gRPC, own service
await ctx.http('GET', '/sessions');                                            // REST, own service
await ctx.http('POST', 'session-manager:/sessions/7/log', { body: { v: 12 } }); // REST, a service in binds.uses
await ctx.call('catalog:catalog.v1.Catalog/List', {});                         // gRPC, a service in binds.uses
```

## 3. `ctx.http` reference

```js
ctx.http(method, path, { query, body, headers, timeout })
```

| Argument | Value |
|---|---|
| `method` | `GET`, `POST`, `PUT`, `PATCH` or `DELETE` |
| `path` | `"/sessions/7"` for the bound service; `"<consul>:/path"` for a service in `binds.uses`. No query, `#`, `..`, scheme or host. |
| `query` | `{ name: value }`, URL-encoded by the bridge. Don't put `?` in the path. |
| `body` | any JSON value, sent as `application/json` |
| `headers` | `{ name: value }` with lowercase names. Reserved: `host`, `cookie`, `origin`, `referer`, `content-length`, `connection`, `x-request-id`, `x-mm-user`, `proxy-*`, `sec-*`. |
| `timeout` | milliseconds; default 30 s, at most 300 s |

The bridge adds `x-request-id` and `x-mm-user` (the login name of this
PC) to every request, as it does for gRPC calls, so the service can log
who did what.

**A 2xx answer resolves** with:

| Field | Value |
|---|---|
| `status` | the HTTP status |
| `headers` | answer headers, lowercase names (without `Set-Cookie`) |
| `type` | `"json"` (body parsed), `"text"`, or `"base64"` (binary) |
| `body` | the answer body |
| `requestId` | the `x-request-id` the service saw |

**Anything else rejects** with an `Error` whose `code` is:

| `code` | Meaning | Also on the error |
|---|---|---|
| `HttpError` | the service answered with a status that is not 2xx (a redirect is not followed) | `status`, `body`, `requestId` |
| `BridgeError` | the call never reached the service: not in Consul or not passing, service down, bridge down, answer over 8 MB | `requestId` |
| `NotBound` | the path is not `/…`, or the service is neither `binds.consul` nor in `binds.uses` | |
| `CapabilityDenied` | `http.call` is not in `requires.capabilities` | |
| `BadOptions` | bad `query`, `headers`, `body` or `timeout` | |
| `Suspended` | the tile is hidden; calls work again after `resume` | |

## 4. Check the manifest

From the Manager GUI folder:

```
node tools/endo-lint.js web/services/<folder>/component.json
```

It warns when `http.call` is declared with a shell range that also takes
2.3 (use `"^2.4"`), or without `binds.consul`.

## 5. Troubleshooting

| Symptom | What to check |
|---|---|
| `BridgeError … not found in Consul` | `curl "http://127.0.0.1:8500/v1/health/service/<name>?passing=true"` must list the service, with a passing check. |
| `BridgeError … connection refused` | The address Consul has is not where the REST API listens. For a service with gRPC on its Consul port, set `Meta.http_port`. |
| `HttpError` 404 / 422 | The path or body does not match the service's API; see its `/openapi.json`. `e.body.detail` holds FastAPI's reason. |
| `NotBound` | The path must start with `/`; another service must be in `binds.uses`. |
| `CapabilityDenied` | Add `http.call` to `requires.capabilities`. |

To test the bridge alone, without the GUI (the bridge listens on port
1112 by default):

```
curl -X POST http://127.0.0.1:1112/api/http/call -H "Content-Type: application/json" -d "{\"consul_name\":\"<name>\",\"method\":\"GET\",\"path\":\"/openapi.json\"}"
```

More on components, bindings and capabilities: [the Manager GUI guide](index.md).
