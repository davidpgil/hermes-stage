"""Hermes Stage — `hermes stage` CLI entrypoint.

Public surfaces only: the plugin registers a CLI subcommand and launches its own
Ink host. It does not import Hermes core modules, patch core code, or touch the
stock `hermes --tui` renderer.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent
STAGE_ENTRY = PLUGIN_ROOT / "stage" / "entry.mjs"


def _profile_home() -> Path:
    """Active profile home; default profile home is ~/.hermes."""
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env)
    base = os.environ.get("HERMES_REAL_HOME") or str(Path.home())
    return Path(base) / ".hermes"


def _install_root() -> Path | None:
    """Locate the Hermes install that ships ui-tui/dist/scripts/gateway_bootstrap.py.

    Resolves the `hermes` launcher first (its real path is inside the install tree),
    then falls back to the interpreter path and the usual home layout. No Hermes
    core imports.
    """
    candidates: list[Path] = []

    launcher = shutil.which("hermes")
    if launcher:
        candidates.extend(Path(launcher).resolve().parents)

    candidates.extend(Path(sys.executable).resolve().parents)

    for base in (os.environ.get("HERMES_INSTALL_DIR"),
                 os.environ.get("HERMES_HOME"),
                 os.path.join(os.environ.get("HERMES_REAL_HOME", "") or str(Path.home()), ".hermes")):
        if base:
            candidates.append(Path(base))
            candidates.append(Path(base) / "hermes-agent")

    seen: set[Path] = set()
    for parent in candidates:
        if parent in seen:
            continue
        seen.add(parent)
        if (parent / "ui-tui" / "dist" / "scripts" / "gateway_bootstrap.py").exists():
            return parent
    return None


def _setup(parser) -> None:
    parser.add_argument(
        "--stage-dir",
        default=str(STAGE_ENTRY.parent),
        help="Directory containing the Stage host (default: bundled stage/)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the resolved Stage entrypoint and environment instead of launching it",
    )


def _handler(args) -> int:
    stage_dir = Path(getattr(args, "stage_dir", "") or STAGE_ENTRY.parent)
    entry = stage_dir / "entry.mjs"

    root = _install_root()
    default_home = _profile_home()

    if getattr(args, "dry_run", False):
        print(f"stage_dir: {stage_dir}")
        print(f"entry:     {entry} (exists={entry.exists()})")
        print(f"install:   {root}")
        print(f"python:    {sys.executable}")
        print(f"node:      {shutil.which('node')}")
        print(f"profile:  {default_home}")
        return 0

    if not entry.exists():
        print(
            "Hermes Stage: the Ink host is missing.\n"
            f"Expected entrypoint: {entry}",
            file=sys.stderr,
        )
        return 3

    if root is None:
        print(
            "Hermes Stage: could not locate the Hermes install (ui-tui gateway bootstrap).",
            file=sys.stderr,
        )
        return 4

    node = shutil.which("node")
    if not node:
        print("Hermes Stage: `node` not found on PATH (Node 20+ required).", file=sys.stderr)
        return 2

    if not (stage_dir / "node_modules" / "ink").exists():
        print(
            "Hermes Stage: stage dependencies are not installed.\n"
            f"Run: cd {stage_dir} && npm install --no-audit --no-fund",
            file=sys.stderr,
        )
        return 5

    env = dict(os.environ)
    env["HERMES_STAGE_ROOT"] = str(root)
    env["HERMES_STAGE_PY"] = sys.executable
    env["HERMES_STAGE_HOME"] = str(default_home)
    os.execve(node, [node, str(entry)], env)
    return 0  # unreachable


def register(ctx) -> None:
    ctx.register_cli_command(
        "stage",
        "Launch Hermes Stage (multi-profile Ink room over the canonical gateway)",
        _setup,
        _handler,
        description="Hermes Stage: multi-profile room over the canonical gateway.",
    )
