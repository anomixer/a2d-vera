#!/usr/bin/env python3
"""Build the VERA variant in an isolated tree based on an original a2d checkout."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


VERA_DIR = Path(__file__).resolve().parent
BUILD_DIR = VERA_DIR / "build"
WORKSPACE = BUILD_DIR / "workspace"


def safe_remove_workspace() -> None:
    build_root = BUILD_DIR.resolve()
    target = WORKSPACE.resolve()
    if not target.is_relative_to(build_root) or target == build_root:
        raise RuntimeError(f"Refusing to remove path outside VERA build area: {target}")
    if target.exists():
        shutil.rmtree(target)


def source_ignore(_directory: str, names: list[str]) -> set[str]:
    # `vera-mirror` (and the sibling `verasd`) hold a disposable `build/`
    # workspace. Copying either into the new workspace is what makes a second
    # build recurse until it blows the stack, so they are never copied from the
    # source tree -- their overlays are applied explicitly by `prepare()`.
    return {name for name in names if name in {".git", "out", "vera-mirror", "verasd"}}


def link_or_copy(source: str, destination: str) -> str:
    try:
        os.link(source, destination)
        return destination
    except OSError:
        return shutil.copy2(source, destination)


def overlay_tree(source: Path, destination: Path) -> None:
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        target = destination / relative
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # The workspace uses hard links where possible. Unlink first so an
        # overlay can never write through a hard link into the original tree.
        target.unlink(missing_ok=True)
        shutil.copy2(item, target)


def git_paths() -> list[str]:
    git = shutil.which("git")
    if not git:
        return []
    root = Path(git).resolve().parent.parent
    return [str(root / "usr" / "bin"), str(root / "bin")]


def prepare(source: Path) -> dict[str, str]:
    if not (source / "src" / "desktop" / "desktop.s").is_file():
        raise FileNotFoundError(f"Not an a2d source tree: {source}")

    safe_remove_workspace()
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, WORKSPACE, ignore=source_ignore, copy_function=link_or_copy)

    # Overlay only VERA-owned replacements. All other source remains the
    # original checkout, and hard-linked files are detached before replacement.
    overlay_tree(VERA_DIR / "src", WORKSPACE / "src")
    overlay_tree(VERA_DIR / "bin", WORKSPACE / "bin")
    for name in ("driver", "images", "tools", "verasd"):
        overlay_tree(VERA_DIR / name, WORKSPACE / "vera" / name)

    env = os.environ.copy()
    env["PATH"] = os.pathsep.join(
        [
            r"C:\dev\cc65\bin",
            *git_paths(),
            env.get("PATH", ""),
        ]
    )
    git_dir = source / ".git"
    if git_dir.is_dir():
        env["GIT_DIR"] = str(git_dir)
    elif git_dir.is_file():
        marker = git_dir.read_text(encoding="utf-8").strip()
        if marker.startswith("gitdir:"):
            metadata = Path(marker.partition(":")[2].strip())
            env["GIT_DIR"] = str((source / metadata).resolve() if not metadata.is_absolute() else metadata)
    return env


def build(source: Path) -> None:
    env = prepare(source)
    command = ["make", "-C", "src/desktop", "OUTDIR=../../vera/build/generated"]
    subprocess.run(command, cwd=WORKSPACE, env=env, check=True)
    subprocess.run([sys.executable, "vera/tools/inspect_prodos.py"], cwd=WORKSPACE, env=env, check=True)

    # Only the 800K hard-disk image is shipped. The 140K floppy variant is not
    # produced: it lacks MODULES/THIS.APPLE and the rest of the DeskTop 1.6
    # distribution, so "About This Apple II" and several desk accessories fail,
    # and it would take six floppies to distribute anyway.
    built_image = WORKSPACE / "vera" / "images" / "A2DeskTop-VERA.hdv"
    if built_image.exists():
        final_image = VERA_DIR / "images" / "A2D-vera-mirror.hdv"
        shutil.copy2(built_image, final_image)
        print(f"Built VERA disk image: {final_image}")

    for stale in ("A2DeskTop-VERA.po", "A2DeskTop-VERA.hdv"):
        stale_path = VERA_DIR / "images" / stale
        if stale_path.exists():
            stale_path.unlink()
            print(f"Removed superseded image: {stale_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(r"C:\dev\org\a2d"))
    parser.add_argument("--clean", action="store_true", help="remove only vera/build/workspace")
    args = parser.parse_args()

    if args.clean:
        safe_remove_workspace()
        print(f"Removed generated workspace: {WORKSPACE}")
        return

    build(args.source.resolve())


if __name__ == "__main__":
    main()
