"""Locked npm dependencies and separate installer/portable Electron rules."""

def _npm_dependencies_impl(ctx):
    windows = ctx.os.name.lower().startswith("windows")
    if not windows and ctx.os.name.lower() != "linux":
        fail("Electron packaging supports Windows and Linux x64 build hosts only.")
    if ctx.os.arch not in ["amd64", "x86_64"]:
        fail("Electron packaging requires an x64 build host, got: %s" % ctx.os.arch)
    node = ctx.path(ctx.attr.node_windows if windows else ctx.attr.node_linux)
    npm = node.dirname.get_child("node_modules/npm/bin/npm-cli.js") if windows else node.dirname.dirname.get_child("lib/node_modules/npm/bin/npm-cli.js")
    ctx.file("package.json", ctx.read(ctx.attr.package_json))
    ctx.file("package-lock.json", ctx.read(ctx.attr.package_lock))
    result = ctx.execute(
        [str(node), str(npm), "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--include=dev"],
        environment = {"PATH": str(node.dirname) + (";" if windows else ":") + ctx.os.environ.get("PATH", "")},
        timeout = 1200,
        quiet = False,
    )
    if result.return_code:
        fail("npm ci failed:\n%s\n%s" % (result.stdout, result.stderr))
    permissions = ctx.execute([str(node), "-e", """
const fs = require('node:fs');
const path = require('node:path');
function makeWritable(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) makeWritable(filename);
        else if (entry.isFile()) fs.chmodSync(filename, fs.statSync(filename).mode | 0o200);
    }
}
makeWritable('node_modules');
"""])
    if permissions.return_code:
        fail("Cannot normalize npm file permissions:\n%s" % permissions.stderr)
    ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["package.json"])
filegroup(
    name = "dependencies",
    srcs = glob(["node_modules/**"], exclude = ["node_modules/.bin/**"]),
)
""")

npm_dependencies = repository_rule(
    implementation = _npm_dependencies_impl,
    attrs = {
        "package_json": attr.label(mandatory = True, allow_single_file = True),
        "package_lock": attr.label(mandatory = True, allow_single_file = True),
        "node_windows": attr.label(mandatory = True, allow_single_file = True),
        "node_linux": attr.label(mandatory = True, allow_single_file = True),
    },
    environ = ["PATH", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NPM_CONFIG_REGISTRY", "NPM_CONFIG_USERCONFIG", "NODE_EXTRA_CA_CERTS"],
)

def _electron_package_impl(ctx):
    extension = "exe" if ctx.attr.platform == "win32" else ("deb" if ctx.attr.format == "installer" else "AppImage")
    output = ctx.actions.declare_directory("DevAtServGUI-unpacked-x64") if ctx.attr.format == "unpacked" else ctx.actions.declare_file("DevAtServGUI-%s-x64.%s" % (ctx.attr.format, extension))
    manifest = ctx.actions.declare_file(ctx.label.name + ".sources.json")
    prefix = ctx.file._package.short_path.removesuffix("package.json")
    ctx.actions.write(manifest, json.encode([
        {"source": source.path, "destination": source.short_path.removeprefix(prefix)}
        for source in ctx.files.srcs
    ]))
    ctx.actions.run(
        executable = ctx.executable.node,
        arguments = [ctx.file._builder.path, manifest.path, ctx.file._npm_package.path, output.path, ctx.attr.platform, ctx.attr.format, ctx.file._runtime_metadata.path],
        inputs = depset(ctx.files.srcs + [manifest, ctx.file._builder, ctx.file._smoke, ctx.file._npm_package, ctx.file._runtime_metadata], transitive = [ctx.attr._dependencies[DefaultInfo].files, ctx.attr._runtime[DefaultInfo].files]),
        outputs = [output],
        mnemonic = "ElectronPackage",
        progress_message = "Packaging %s x64 Electron %s" % (ctx.attr.platform, ctx.attr.format),
        use_default_shell_env = True,
        execution_requirements = {"local": "1", "no-remote": "1"},
    )
    return [DefaultInfo(files = depset([output]))]

_electron_package = rule(
    implementation = _electron_package_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True),
        "format": attr.string(mandatory = True, values = ["installer", "portable", "unpacked"]),
        "platform": attr.string(mandatory = True, values = ["win32", "linux"]),
        "node": attr.label(mandatory = True, executable = True, cfg = "exec", allow_single_file = True),
        "_package": attr.label(default = Label("//:package.json"), allow_single_file = True),
        "_builder": attr.label(default = Label("//tools:build-portable.cjs"), allow_single_file = True),
        "_smoke": attr.label(default = Label("//tools:smoke-python.cjs"), allow_single_file = True),
        "_runtime_metadata": attr.label(default = Label("@gui_python//:runtime/runtime.json"), allow_single_file = True),
        "_runtime": attr.label(default = Label("@gui_python//:files")),
        "_npm_package": attr.label(default = Label("@gui_npm//:package.json"), allow_single_file = True),
        "_dependencies": attr.label(default = Label("@gui_npm//:dependencies")),
    },
)

def _package(name, srcs, format, **kwargs):
    _electron_package(
        name = name,
        srcs = srcs,
        format = format,
        platform = select({
            "@platforms//os:windows": "win32",
            "@platforms//os:linux": "linux",
        }),
        node = select({
            "@platforms//os:windows": Label("@nodejs_windows_amd64//:bin/nodejs/node.exe"),
            "@platforms//os:linux": Label("@nodejs_linux_amd64//:bin/nodejs/bin/node"),
        }),
        target_compatible_with = ["@platforms//cpu:x86_64"] + select({
            "@platforms//os:windows": [],
            "@platforms//os:linux": [],
            "//conditions:default": ["@platforms//:incompatible"],
        }),
        **kwargs
    )

def electron_installer(name, srcs, **kwargs):
    """Build an NSIS installer on Windows or a Debian package on Linux."""
    _package(name, srcs, "installer", **kwargs)

def electron_portable(name, srcs, **kwargs):
    """Build a portable executable on Windows or an AppImage on Linux."""
    _package(name, srcs, "portable", **kwargs)

def electron_unpacked(name, srcs, **kwargs):
    """Build an Electron app directory including the bundled Python runtime."""
    _package(name, srcs, "unpacked", **kwargs)