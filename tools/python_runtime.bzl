"""Prepare a relocatable CPython runtime with hash-locked GUI dependencies."""

_UV_VERSION = "0.11.25"
_PYTHON_VERSION = "3.12.13"

def _python_runtime_impl(ctx):
    windows = ctx.os.name.lower().startswith("windows")
    if ctx.os.arch not in ["amd64", "x86_64"] or (not windows and ctx.os.name.lower() != "linux"):
        fail("The bundled GUI runtime requires a Windows or Linux x64 build host")
    archive = "uv-x86_64-pc-windows-msvc.zip" if windows else "uv-x86_64-unknown-linux-gnu.tar.gz"
    ctx.download_and_extract(
        url = "https://github.com/astral-sh/uv/releases/download/%s/%s" % (_UV_VERSION, archive),
        sha256 = "15bfd1423b7eaa7aae949922d4712ebaac2bb44a81af64ab59bbe007090cb0d0" if windows else "1db18b5e76fa645a7f3865773139bdec8e2d46adbdbb35e7410b34fa8015ccd2",
        output = "uv",
        stripPrefix = "" if windows else "uv-x86_64-unknown-linux-gnu",
    )
    uv = ctx.path("uv/uv.exe" if windows else "uv/uv")
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
    environ = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "UV_INDEX_URL", "UV_DEFAULT_INDEX", "SSL_CERT_FILE", "UV_SYSTEM_CERTS"],
)