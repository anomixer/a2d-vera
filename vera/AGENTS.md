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
- `patches/desktop-integration.patch` — the changes needed to integrate the VERA driver into the original DeskTop sources, including the CRLF font-parser fix.
- `images/` — base and VERA-enabled ProDOS disk images.
- `tools/verify_vera.py` — compares captured VERA VRAM with the DHGR source in a save state.
- `tools/inspect_prodos.py` — inserts the built DeskTop module into `images/A2DeskTop-base.po` and writes `images/A2DeskTop-VERA.po`.
- `captures/` — AppleWin screenshots, save states, and VRAM dumps used for verification.

## Display format and memory map

- The DeskTop framebuffer is 560x192 DHGR. Each scanline consists of 40 seven-bit AUX bytes and 40 seven-bit MAIN bytes in alternating display order.
- VERA Layer 0 is configured as a 640-pixel-wide, 1bpp bitmap at VRAM `$00000`, with an 80-byte row stride. The blitter packs each 560-pixel DHGR row into 70 bytes; the remaining row bytes are padding. The framebuffer occupies 38,400 bytes.
- The VERA composer scales the bitmap to the 640x480 VGA output. Do not exceed the 128 KB VRAM capacity.
- `driver/vera_drv.s` resides in the auxiliary-memory segment. `driver/vera_lc.s` and the DHGR row-copy helper in `src/desktop/lc.s` use the language-card segment for safe AUX/MAIN reads.
- Resident segments have very little free space. Check the linker map after code changes and keep new code within the available padding.
- Re-establish VERA zero-page pointers at driver entry points because Desk Accessories share zero page and may overwrite them.
- Do not reset VERA during initialization. Configure only the video registers required by this driver so a co-resident SD driver is not disturbed.

## Build and image packaging

The original DeskTop source files are kept unchanged in this checkout. To build the VERA variant, create a disposable checkout of the original `a2d` source, copy this `vera/` directory into its root, and apply the integration patch there. From the root of that disposable checkout:

```sh
export PATH="/c/dev/cc65/bin:$PATH"
git apply --check vera/patches/desktop-integration.patch
git apply vera/patches/desktop-integration.patch
make -C src/desktop
python vera/tools/inspect_prodos.py
```

The integration patch touches only the disposable checkout. `make -C src/desktop` writes generated files to that checkout's root-level `out/` directory. `inspect_prodos.py` reads `vera/images/A2DeskTop-base.po` and writes `vera/images/A2DeskTop-VERA.po`. Close AppleWin before replacing a mounted image. The generated `out/` directory can be removed after packaging.

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
2. Open a volume or folder and verify the complete window contents repaint to VERA after UI events.
3. Run DeskTop with VeraSD-IFS-ProDOS in the same system and verify SD reads while VERA output is active.
4. Validate output on a physical VERA card.

## References

- VERA Programmer's Reference: <https://github.com/X16Community/x16-docs/blob/master/X16%20Reference%20-%2009%20-%20VERA%20Programmer's%20Reference.md>
- VeraSD-IFS-ProDOS source: `C:\dev\verasdtool\src\verasd-prodos`
- VERA-enabled AppleWin source and behavior notes: `C:\dev\AppleWin\VERA.md`
