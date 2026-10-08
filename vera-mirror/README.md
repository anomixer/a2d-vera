# `vera-mirror` — Apple II DeskTop with VERA screen mirroring

This directory builds **DeskTop 1.6 for the Apple II with its DHGR screen mirrored
onto an [Adrian's Digital Basement VERA card](https://github.com/misterblack1/a2vera)**
as a 640x480 VGA image.

It is a **frozen deliverable**. The output is
[`images/A2D-vera-mirror.hdv`](images/A2D-vera-mirror.hdv) and that is the end of
this line of work. A separate branch, `a2d-verasd`, continues with a plain-DHGR
DeskTop plus VERA SD-card support.

`AGENTS.md` in this directory holds the detailed engineering log, the measured
memory map, and the VERA SD-card coexistence investigation. This file is the
short version.

## What is in here

| Path | What it is |
| --- | --- |
| `driver/vera_drv.s` | VERA detection, register setup, and the DHGR-to-VRAM blitter. Linked into the aux memory segment. |
| `driver/vera_lc.s` | Language-card resident helpers used to read AUX and MAIN safely while banking. |
| `src/` | VERA-owned replacements for original DeskTop source. Only these copies are used; the upstream tree is left untouched. |
| `bin/` | VERA-owned replacements for build utilities, including the CRLF font-parser fix. |
| `build.py`, `Makefile` | Create an isolated build workspace from a pristine a2d checkout, overlay the files above, build, and package the disk image. |
| `tools/inspect_prodos.py` | Inserts the built DeskTop module into a base ProDOS volume. |
| `tools/verify_vera.py` | Compares a captured VERA VRAM dump against the DHGR source in a matching save state. |
| `images/A2D-vera-mirror.hdv` | **The deliverable.** 819,200 bytes, raw ProDOS volume. |
| `images/A2DeskTop-base.hdv`, `A2DeskTop-base.po` | Build inputs. Pristine DeskTop 1.6 volumes. Do not delete. |
| `build/` | Disposable build workspace. Recreated by the build, safe to delete. |

## Building

The build needs [cc65](https://cc65.github.io/cc65/) on `PATH` and a pristine
a2d source tree to base the build on. It does not modify that source tree.

```powershell
# with cc65 in PATH
$env:PATH = 'C:\dev\cc65\bin;' + $env:PATH

# default source location is C:/dev/org/a2d
python vera-mirror\build.py

# or point it somewhere else
python vera-mirror\build.py --source C:/path/to/original/a2d

# or via make
make -C vera-mirror build A2D_SOURCE=C:/path/to/original/a2d

# drop the disposable workspace
python vera-mirror\build.py --clean
```

Only the 800K hard-disk image is produced. Close AppleWin first if the image is
mounted, since Windows will otherwise hold a lock on the file.

## Running

Use the VERA-enabled AppleWin fork at `C:\dev\AppleWin\Release\AppleWin.exe`.
VERA must be in **slot 2** or slot 4; slot 2 is the verified configuration.

```powershell
$args = '-no-di -s2 vera -h1 "" -h2 "" -d1 "" -d2 "" -d3 "C:\dev\a2d\vera-mirror\images\A2D-vera-mirror.hdv" -power-on'
Start-Process -FilePath 'C:\dev\AppleWin\Release\AppleWin.exe' -ArgumentList $args -WorkingDirectory 'C:\dev\a2d'
```

**Eject the other drives.** AppleWin remembers the last image per slot in
`HKCU\Software\AppleWin\CurrentVersion\Configuration\Slot N`, and a stale
`A2DeskTop-VERA.hdv` left on HDD2 will produce a spurious
"There are 2 volumes with the same name" alert, because that image's volume is
also called `A2.DeskTop`. Hence `-h1 "" -h2 "" -d1 "" -d2 ""`.

Apple2TS works too. Attach `C:\dev\verasdtool\VeraSD-IFS-ProDOS.img` as the VERA
SD card if you want to see the SD volume, but note it will not be usable from
DeskTop — see the limitations.

Do **not** pass `-log`. The AppleWin fork logs DATA0 writes, and one full DHGR
refresh streams 13,440 framebuffer bytes, which turns a refresh into thousands of
file operations and effectively stalls the emulator.

## Limitations

These are accepted, not open bugs. This build is a demonstration of DHGR-to-VERA
mirroring, not a drop-in replacement for running software on a real VERA setup.

- **Slow.** Every full refresh pushes 13,440 bytes to VERA over the emulated
  SPI link. Responsiveness is noticeably worse than plain DHGR on the Apple II
  screen.
- **Visual glitches.** The mirrored image can lag, tear between redraws, or show
  a partially updated frame. Mirroring is dirty-flag driven: it blits after a
  nonzero event settles rather than tracking the Apple II frame boundary, so
  intermediate frames are skipped.
- **Not frame-synchronised with DHGR.** The VERA image will not match the Apple II
  screen at any given instant. Treat the Apple II screen as the source of truth.
- **Traditional GR / HGR / HGR2 programs show nothing.** Only DHGR is mirrored.
  Anything that switches to 40-column text, monochrome hires, or double hires is
  not captured at all — you get a blank or stale VERA image.
- **VERA SD card is not usable.** VeraSD-IFS-ProDOS builds and installs correctly
  on its own (`VERASD INSTALLED`, `/VERASD` listing 65,535 blocks), but it cannot
  coexist with this build. It needs an 80-byte gate in Language Card *common*
  memory, and all of LC common above `$F195` is DeskTop's `icon_entries` heap.
  The gate does not have to live in the language card at all -- it only needs to
  be reachable by ProDOS's `JMP ($BF26)`, and main RAM qualifies. Putting it at
  `$AED1` installs and reads the SD volume successfully. That work lives on the
  separate `verasd` branch.
- **Slot 2 is hardcoded.** Auto-detection exists in `vera_detect` but is bypassed.
- **Never tested on physical VERA hardware.** All verification was done on the
  AppleWin fork and Apple2TS.
- **Menus and windows are not pixel-verified.** The headless regression test
  asserts that blitting completes without a fault, not that the resulting
  framebuffer is correct.