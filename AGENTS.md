# a2desktop VERA handoff

Updated 2026-09-30. This file describes the verified code and remaining work.

## Goal

Mirror the Apple II DeskTop DHGR display to Adrian's Digital Basement VERA VGA
output, with VeraSD-IFS-ProDOS coexistence, then support VERA in slots 1-7.

## Verified current state

- The DeskTop menu and icons are drawn into the full-screen DHGR graphics page.
  `InitGrafImpl` sets `$71`; MGTK `SetMenu` draws the menu background with
  `FillAndFrameRect` and titles with `DrawText`. Text-page rendering is not
  needed.
- The menu was missing because `out/System.en.font` was empty. The font builder
  retained `\r` from CRLF input, failed to parse the source, and left an empty
  generated font. MGTK `SetMenu` returned `$83` (`font_too_big`) as a result.
  `bin/build_font_from_unicode_txt.pl` now removes the trailing CR. The rebuilt
  font is 1,283 bytes and has header `00 7f 09 04`; the menu appears on both the
  native AppleWin display and VERA.
- AppleWin VERA in slot 2 now displays the complete DHGR desktop at 640x480.
  Capture: `vera/captures/vera_working.png`. Pixel verification passes all 192
  rows:

  ```powershell
  python vera/tools/verify_vera.py vera/captures/vera_working.sav vera/captures/vera_working.vram
  ```

- The current `vera_init` temporarily selects slot 2 directly. **Do not claim
  slot 1-7 detection yet.** The auto-detection routine currently returns no
  card after the code split and needs repair. Slot 2 output was validated with
  AppleWin's `-s2 vera` configuration.
- Folder/window repaint on VERA, physical VERA hardware, and combined runtime
  testing with VeraSD-IFS-ProDOS are still outstanding. The IFS driver was only
  checked for register/zero-page conflicts by source review.

## Drawing and memory details

- The DHGR display is 560x192. Each scanline interleaves 40 AUX and 40 MAIN
  seven-bit bytes. MGTK's `DHGRGetSrcbits` uses this same AUX/MAIN order.
- VERA Layer 0 uses a 640-pixel-wide 1bpp bitmap (80-byte stride) at VRAM
  `$00000`. Each DHGR row becomes 70 bytes; the composer scales 560x192 to
  640x480. The bitmap uses 38,400 bytes total.
- `vera/driver/vera_drv.s` contains the blitter in AUX RAM. It reuses MGTK's
  `hires_table_lo/hi` scanline tables to conserve AUX space.
- `vera/driver/vera_lc.s` contains helpers split into the language-card segment.
  `vera_copy_dhr_row` is in `src/desktop/lc.s`; it switches PAGE2/PAGE1 to read
  AUX/MAIN while remaining executable during RAMRD changes.
- `vera_patch_main_slot` must preserve the selected slot before switching
  MAIN/AUX visibility. Read the slot into A and push it before writing
  `RAMRDOFF`/`RAMWRTOFF`; after switching, reading AUX variables returns MAIN
  data instead.
- Latest successful linker padding: AUX 9 bytes, LC 34 bytes, Main 177 bytes.
  Recheck after any code changes; these resident segments are tightly packed.

## Build and AppleWin capture

Use cc65 from `C:\dev\cc65\bin`:

```powershell
$env:PATH = 'C:\dev\cc65\bin;' + $env:PATH
ca65 --target apple2 --list-bytes 0 --warnings-as-errors -o out\desktop.o src\desktop\desktop.s
ld65 --config src\common\asm.cfg --warnings-as-errors -m out\desktop.map -o out\desktop.built out\desktop.o
python vera\tools\inspect_prodos.py
```

`vera/tools/inspect_prodos.py` replaces the fixed-size DeskTop module in
`out/A2DeskTop.po` and writes `vera/images/A2DeskTop-VERA.po`. Stop AppleWin before
repackaging because mounted disk images can be locked.

For AppleWin, pass one raw PowerShell argument string so the empty HDD1 argument
is preserved:

```powershell
$args = '-no-di -s2 vera -h1 "" -d1 "C:\dev\a2d\vera\images\A2DeskTop-VERA.po" -power-on -log'
Start-Process -FilePath 'C:\dev\AppleWin\Release\AppleWin.exe' -ArgumentList $args -WorkingDirectory 'C:\dev\a2d'
```

Verification captures can add `-run-cycles 40000000 -save-state <file>
-vera-dump <file> -screenshot-and-exit <file>`.

## Remaining work

1. Repair auto-detection while retaining slot-2 output; test slots 2 and 4 in
   AppleWin and slots 1-7 on real hardware where possible.
2. Open a volume/folder and verify full window repaint after UI events.
3. Run DeskTop with VeraSD-IFS-ProDOS on the same image and verify SD reads.
4. Test on a physical VERA card.
