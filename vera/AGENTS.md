# Apple II DeskTop VERA Support

## Purpose

This directory contains the VERA display driver, disk images, verification tools, captures, and development notes for mirroring the Apple II DeskTop DHGR screen to an Adrian's Digital Basement VERA card. The driver must coexist with VeraSD-IFS-ProDOS from `C:\dev\verasdtool`.

## Current status

- VERA output has been verified in the VERA-enabled AppleWin fork with the card in slot 2. The desktop is displayed at 640x480 and the startup frame has passed pixel comparison for all 192 DHGR rows.
- The DeskTop menu and icons are drawn on the DHGR graphics page. The previous missing-menu issue was traced to an empty generated `System.en.font`; the font builder now strips CR characters from CRLF input.
- `vera_init` currently selects slot 2 directly. Slot 1-7 auto-detection is not currently verified and must not be described as working.
- Folder/window repaint on VERA, physical VERA hardware, and runtime coexistence with VeraSD-IFS-ProDOS still require verification.
- The repository build scripts use a root-level `out` directory for generated build intermediates. It is disposable and is not a location for VERA deliverables. Remove it after building if a clean workspace is required.

## Directory layout

- `driver/vera_drv.s` — VERA detection/configuration, presentation path, and DHGR-to-VRAM blitter.
- `driver/vera_lc.s` — language-card resident VERA helper routines.
- `src/` — VERA-owned replacements for original DeskTop source and build configuration files. Only these copies are used in the VERA build.
- `bin/` — VERA-owned build utility replacements, including the CRLF font-parser fix and generated build metadata path.
- `build.py` and `Makefile` — create an isolated build workspace from an original a2d checkout, overlay VERA-owned files, build the module, and package the disk image.
- `images/` — base and VERA-enabled ProDOS disk images.
- `tools/verify_vera.py` — compares captured VERA VRAM with the DHGR source in a save state.
- `tools/inspect_prodos.py` — inserts the built DeskTop module into `images/A2DeskTop-base.po` and writes `images/A2DeskTop-VERA.po`.
- `captures/` — AppleWin screenshots, save states, and VRAM dumps used for verification.

## Display format and memory map

- The DeskTop framebuffer is 560x192 DHGR. Each scanline consists of 40 seven-bit AUX bytes and 40 seven-bit MAIN bytes in alternating display order.
- VERA Layer 0 is configured as a 640-pixel-wide, 1bpp bitmap at VRAM `$00000`, with an 80-byte row stride. The blitter packs each 560-pixel DHGR row into 70 bytes; the remaining row bytes are padding. The framebuffer occupies 38,400 bytes.
- The VERA composer scales the bitmap to the 640x480 VGA output. Do not exceed the 128 KB VRAM capacity.
- `driver/vera_drv.s` resides in the auxiliary-memory segment. `driver/vera_lc.s` and the DHGR row-copy helper in `vera/src/desktop/lc.s` use the language-card segment for safe AUX/MAIN reads.
- Resident segments have very little free space. Check the linker map after code changes and keep new code within the available padding.
- Re-establish VERA zero-page pointers at driver entry points because Desk Accessories share zero page and may overwrite them.
- Do not reset VERA during initialization. Configure only the video registers required by this driver so a co-resident SD driver is not disturbed.

## Build and image packaging

The original DeskTop source files are kept unchanged. Build from the pristine source tree at `C:\dev\org\a2d` (or specify another original checkout). The build script creates a disposable workspace under `vera/build/workspace`, uses the original files as its base, and overlays files from `vera/src/` and `vera/bin/`. It does not modify the original source tree or create a root-level `out/` directory.

```powershell
make -C vera build
# Or choose another original source checkout:
make -C vera build A2D_SOURCE=C:/path/to/original/a2d
```

Generated build files stay below `vera/build/workspace/vera/build/generated`; the packaged image is copied to `vera/images/A2DeskTop-VERA.po`. Close AppleWin before building if that image is mounted. Remove the disposable source copy and generated files with `make -C vera clean`.

The event path marks VERA output dirty when an event arrives. The VERA-owned `main::SystemTask` copy calls `vera_present` after its periodic drawing work, so the frame is flushed after the main event handler completes and during nested modal loops. Copying immediately after `GetNextEvent` captures the old DHGR frame. The VERA build relocates `GetTickCount` and its counter into the shared LC segment to keep the overlay-sensitive main segment within its address limit. The latest build has 15 bytes of LC padding, 67 bytes of AUX padding, and 173 bytes of main padding; check the linker map after any code changes.

## AppleWin run and verification

The VERA-enabled AppleWin build currently supports the card in slot 2 or slot 4. Use slot 2 for the verified configuration. Pass the empty HDD1 argument as part of one raw argument string:

```powershell
$args = '-no-di -s2 vera -h1 "" -d1 "C:\dev\a2d\vera\images\A2DeskTop-VERA.po" -power-on -log'
Start-Process -FilePath 'C:\dev\AppleWin\Release\AppleWin.exe' -ArgumentList $args -WorkingDirectory 'C:\dev\a2d'
```

Verify a captured run with its matching save-state and VRAM dump:

```powershell
python vera\tools\verify_vera.py vera\captures\vera_working.sav vera\captures\vera_working.vram
```

A passing result reports that all 192 DHGR rows match. Verify window redraws interactively; earlier headless input-injection runs stalled after opening a folder and did not provide reliable evidence.

## Outstanding work

1. Repair and validate slot detection. Test slots 2 and 4 in AppleWin, then slots 1-7 on hardware when available.
2. Interactively open a menu, volume/folder, and About window; confirm each redraw appears on VERA. The event-timing fix builds successfully but still needs this interactive confirmation.
3. Run DeskTop with VeraSD-IFS-ProDOS in the same system and verify SD reads while VERA output is active.
4. Validate output on a physical VERA card.

## References

- VERA Programmer's Reference: <https://github.com/X16Community/x16-docs/blob/master/X16%20Reference%20-%2009%20-%20VERA%20Programmer's%20Reference.md>
- VeraSD-IFS-ProDOS source: `C:\dev\verasdtool\src\verasd-prodos`
- VERA-enabled AppleWin source and behavior notes: `C:\dev\AppleWin\VERA.md`
