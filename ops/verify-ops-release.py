"""Fail closed if a release would reuse binaries after source/dependency changes."""
import argparse
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("base")
parser.add_argument("revision")
args = parser.parse_args()
if not all(re.fullmatch(r"[a-f0-9]{40}", value) for value in [args.base, args.revision]):
    raise ValueError("Full git revisions required")
files = subprocess.check_output(["git", "diff", "--name-only", args.base, args.revision]).decode().splitlines()
allowed_files = {"README.md", "CHANGELOG.md", "MASTER-SPEC.yaml", ".gitignore", ".gitattributes"}
disallowed = [name for name in files if name not in allowed_files and not name.startswith(("ops/", "docs/", ".planning/", ".github/"))]
if disallowed:
    raise ValueError("Binary reuse denied; rebuild the full image: "+", ".join(disallowed))
print(f"Ops-only release verified ({len(files)} paths); application sources/dependencies unchanged.")
