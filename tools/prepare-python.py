"""Copy a managed standalone interpreter without non-relocatable bytecode."""

import os
import shutil
import sys
from pathlib import Path


def main() -> None:
    source, environment, destination = map(Path, sys.argv[1:])
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for build_marker in (destination / "BUILD", destination / "BUILD.bazel"):
        build_marker.unlink(missing_ok=True)
    packages = Path("Lib/site-packages") if sys.platform == "win32" else Path("lib/python3.12/site-packages")
    shutil.copytree(
        environment / packages,
        destination / packages,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "_virtualenv.*"),
    )
    for filename in destination.rglob("*"):
        if filename.is_file():
            filename.chmod(filename.stat().st_mode | 0o200)
    for filename in destination.rglob("*.pth"):
        if str(source) in filename.read_text(encoding="utf-8"):
            raise RuntimeError(f"Absolute build path in runtime: {filename}")
    os.chmod(destination, 0o755)


if __name__ == "__main__":
    main()