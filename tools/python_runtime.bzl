"""Prepare a relocatable CPython runtime with hash-locked GUI dependencies."""

_UV_VERSION = "0.11.2"
_PYTHON_VERSION = "3.13.11"

def _get_uv(ctx, windows):
    uv = ctx.which("uv.exe" if windows else "uv")
    if uv:
        ctx.watch(uv)
        version = ctx.execute([str(uv), "--version"], timeout = 30)
        parts = version.stdout.strip().split(" ")
        if version.return_code == 0 and len(parts) >= 2 and parts[0] == "uv" and parts[1] == _UV_VERSION:
            ctx.report_progress("Using uv %s from PATH: %s" % (_UV_VERSION, uv))
            return uv
    archive = "uv-x86_64-pc-windows-msvc.zip" if windows else "uv-x86_64-unknown-linux-gnu.tar.gz"
    ctx.download_and_extract(
        url = "https://releases.astral.sh/github/uv/releases/download/%s/%s" % (_UV_VERSION, archive),
        sha256 = "171b7ccda1bbd562da6babeffcf533a1c6cc7862cf998da826e1db534fc43e48" if windows else "7ac2ca0449c8d68dae9b99e635cd3bc9b22a4cb1de64b7c43716398447d42981",
        output = "uv",
        stripPrefix = "" if windows else "uv-x86_64-unknown-linux-gnu",
    )
    return ctx.path("uv/uv.exe" if windows else "uv/uv")

def _python_runtime_impl(ctx):
    windows = ctx.os.name.lower().startswith("windows")
    if ctx.os.arch not in ["amd64", "x86_64"] or (not windows and ctx.os.name.lower() != "linux"):
        fail("The bundled GUI runtime requires a Windows or Linux x64 build host")
    uv = _get_uv(ctx, windows)
    ctx.file("pyproject.toml", ctx.read(ctx.attr.manifest))
    ctx.file("uv.lock", ctx.read(ctx.attr.lock))
    environment = {
        "UV_CACHE_DIR": str(ctx.path("cache")),
        "UV_PYTHON_INSTALL_DIR": str(ctx.path("downloads")),
        "UV_PYTHON_DOWNLOADS": "manual",
        "SKIP_DOCBUILD": "1",
    }
    result = ctx.execute(
        [str(uv), "python", "install", _PYTHON_VERSION, "--no-bin", "--no-registry", "--no-config", "--no-progress"],
        environment = environment,
        timeout = 1200,
        quiet = False,
    )
    if result.return_code:
        fail("Cannot download bundled CPython:\n%s\n%s" % (result.stdout, result.stderr))
    result = ctx.execute(
        [str(uv), "python", "find", "--managed-python", _PYTHON_VERSION],
        environment = environment,
    )
    if result.return_code:
        fail("Cannot locate managed CPython:\n%s" % result.stderr)
    python = ctx.path(result.stdout.strip())
    installation = python.dirname if windows else python.dirname.dirname
    result = ctx.execute(
        [str(uv), "sync", "--frozen", "--no-dev", "--no-editable", "--python", str(python)],
        environment = environment,
        timeout = 1200,
        quiet = False,
    )
    if result.return_code:
        fail("Cannot install locked Python dependencies:\n%s\n%s" % (result.stdout, result.stderr))
    result = ctx.execute(
        [str(python), "-I", str(ctx.path(ctx.attr.prepare)), str(installation), str(ctx.path(".venv")), str(ctx.path("runtime"))],
        timeout = 300,
    )
    if result.return_code:
        fail("Cannot stage relocatable Python:\n%s\n%s" % (result.stdout, result.stderr))
    ctx.file("runtime/runtime.json", json.encode({"python": _PYTHON_VERSION, "uv": _UV_VERSION}))
    ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["runtime/runtime.json"])
filegroup(name = "files", srcs = glob(["runtime/**"]))
""")
    ctx.delete("cache")
    ctx.delete("downloads")
    ctx.delete("uv")
    ctx.delete(".venv")

python_runtime = repository_rule(
    implementation = _python_runtime_impl,
    attrs = {
        "manifest": attr.label(mandatory = True, allow_single_file = True),
        "lock": attr.label(mandatory = True, allow_single_file = True),
        "prepare": attr.label(default = Label("//tools:prepare-python.py"), allow_single_file = True),
    },
    environ = ["PATH", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "UV_INDEX_URL", "UV_DEFAULT_INDEX", "SSL_CERT_FILE", "UV_SYSTEM_CERTS"],
)