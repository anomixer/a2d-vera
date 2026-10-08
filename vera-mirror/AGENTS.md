# Apple II DeskTop VERA Support — `A2D-vera-mirror.hdv`

## Finalized artifact

**`images/A2D-vera-mirror.hdv` (800K raw ProDOS volume) is the deliverable for this
line of work. It is frozen.** Only the 800K hard-disk image is built; the 140K
floppy variant is not produced because it lacks `MODULES/THIS.APPLE` and the rest
of the DeskTop 1.6 distribution (so "About This Apple II" and several desk
accessories fail) and would take six floppies to distribute.

Run it with the VERA-enabled AppleWin fork, VERA in slot 2:

```powershell
$args = '-no-di -s2 vera -h1 "" -h2 "" -d1 "" -d2 "" -d3 "C:\dev\a2d\vera-mirror\images\A2D-vera-mirror.hdv" -power-on'
Start-Process -FilePath 'C:\dev\AppleWin\Release\AppleWin.exe' -ArgumentList $args -WorkingDirectory 'C:\dev\a2d'
```

Eject both hard drives (`-h1 "" -h2 ""`) and both extra floppies. AppleWin
remembers the last image per slot in the registry under
`HKCU\Software\AppleWin\CurrentVersion\Configuration\Slot N`, and a stale
`A2DeskTop-VERA.hdv` on HDD2 previously produced a spurious "There are 2 volumes
with the same name" alert because both volumes were called `A2.DeskTop`.

## Known limitations (accepted, not bugs to fix here)

- **Slow.** Each full DHGR refresh streams 13,440 framebuffer bytes to VERA.
- **Not 100% frame-synchronised with DHGR.** Mirroring is dirty-flag driven
  (`vera_present` blits after a nonzero event settles), so the VERA image can lag
  or skip intermediate frames relative to the Apple II screen.
- **Traditional GR/HGR programs show nothing.** Only DHGR is mirrored. A program
  that switches to 40-column or pure hires output is not captured.
- Physical VERA hardware has never been tested; all verification is on the
  AppleWin fork and Apple2TS.
- **VeraSD-IFS-ProDOS does not coexist in this build.** See "VeraSD-IFS
  coexistence investigation" below. It is the reason a separate goal exists.

Because of the above, the DHGR-only variant is a separate goal with its own
branch and its own output name (`a2d-verasd` / `A2D-verasd.hdv`). Do not add
SD-card work to this branch.

## Purpose

This directory contains the VERA display driver, disk images, verification tools,
captures, and development notes for mirroring the Apple II DeskTop DHGR screen to
an Adrian's Digital Basement VERA card.

## Current status

- VERA output has been verified in the VERA-enabled AppleWin fork with the card in slot 2. The desktop is displayed at 640x480 and the startup frame has passed pixel comparison for all 192 DHGR rows.
- The DeskTop menu and icons are drawn on the DHGR graphics page. The previous missing-menu issue was traced to an empty generated `System.en.font`; the font builder now strips CR characters from CRLF input.
- `vera_init` currently selects slot 2 directly (hardcoded `$C2`). Slot 1-7 auto-detection code exists in `vera_detect` but is currently bypassed—see comment in `vera_drv.s` line 94-95.
- **Opening a window from a disk works and no longer crashes.** Verified headlessly
  (see "Debug session — 2026-10-07" below) and confirmed interactively on Apple2TS:
  the Control Panel and the disk volume both open, and the window reaches VERA.
  The root cause was not Language Card banking, as previously believed — VERA code
  was being emitted inside the `icon_entries` heap at the top of the LC window.
- Menu clicks reach VERA without crashing (`vera_blit_now` is exercised by the
  repro), but the menu's *appearance* on VERA has not been pixel-verified.
- Generated intermediates live below `vera-mirror/build/workspace/vera/build/generated` and are
  disposable.

## Directory layout

- `driver/vera_drv.s` — VERA detection/configuration, presentation path, and DHGR-to-VRAM blitter.
- `driver/vera_lc.s` — language-card resident VERA helper routines.
- `src/` — VERA-owned replacements for original DeskTop source and build configuration files. Only these copies are used in the VERA build.
- `bin/` — VERA-owned build utility replacements, including the CRLF font-parser fix and generated build metadata path.
- `build.py` and `Makefile` — create an isolated build workspace from an original a2d checkout, overlay VERA-owned files, build the module, and package the disk image.
- `images/` — ProDOS disk images. `A2DeskTop-base.po` (140K floppy) and
  `A2DeskTop-base.hdv` (800K hard drive) are **build inputs**: they are pristine
  DeskTop 1.6 volumes with no DeskTop module injected, and `inspect_prodos.py`
  reads them unconditionally. **`A2D-vera-mirror.hdv` is the only output.** Do not
  delete the base images. The build also writes `A2DeskTop-VERA.hdv` into the
  disposable workspace and then copies it out under the shipped name, deleting any
  superseded `A2DeskTop-VERA.*` from `images/`. A vestigial `-clean` variant (built from
  `A2DeskTop-base-clean.*`) was removed on 2026-10-07: its inputs never existed in
  git, so `A2DeskTop-VERA-clean.po` was never regenerated but was re-published on
  every build and had gone stale.
- `tools/verify_vera.py` — compares captured VERA VRAM with the DHGR source in a save state.
- `tools/inspect_prodos.py` — inserts the built DeskTop module into `images/A2DeskTop-base.po` and writes `images/A2DeskTop-VERA.po`.

## Display format and memory map

- The DeskTop framebuffer is 560x192 DHGR. Each scanline consists of 40 seven-bit AUX bytes and 40 seven-bit MAIN bytes in alternating display order.
- VERA Layer 0 is configured as a 640-pixel-wide, 1bpp bitmap at VRAM `$00000`, with an 80-byte row stride. The blitter packs each 560-pixel DHGR row into 70 bytes; the remaining row bytes are padding. The framebuffer occupies 38,400 bytes.
- The VERA composer scales the bitmap to the 640x480 VGA output. Do not exceed the 128 KB VRAM capacity.
- `driver/vera_drv.s` resides in the auxiliary-memory segment. `driver/vera_lc.s` and the DHGR row-copy helper in `vera-mirror/src/desktop/lc.s` use the language-card segment for safe AUX/MAIN reads.
- Resident segments have very little free space. Check the linker map after code changes and keep new code within the available padding.
- Re-establish VERA zero-page pointers at driver entry points because Desk Accessories share zero page and may overwrite them.
- Do not reset VERA during initialization. Configure only the video registers required by this driver so a co-resident SD driver is not disturbed.

## Build and image packaging

The original DeskTop source files are kept unchanged. Build from the pristine source tree at `C:\dev\org\a2d` (or specify another original checkout). The build script creates a disposable workspace under `vera-mirror/build/workspace`, uses the original files as its base, and overlays files from `vera-mirror/src/` and `vera-mirror/bin/`. It does not modify the original source tree or create a root-level `out/` directory.

```powershell
make -C vera-mirror build
# Or choose another original source checkout:
make -C vera-mirror build A2D_SOURCE=C:/path/to/original/a2d
# Or build directly:
python vera-mirror/build.py --source c:/dev/a2d
```

Generated build files stay below `vera-mirror/build/workspace/vera/build/generated`; the packaged image is copied to `vera-mirror/images/A2D-vera-mirror.hdv`. Close AppleWin before building if that image is mounted. Remove the disposable source copy and generated files with `make -C vera-mirror clean`.

The event path marks VERA output dirty when an event arrives. The VERA-owned `main::SystemTask` copy calls `vera_present` after periodic drawing work, allowing dirty frames to flush during nested modal loops. Blitting immediately after `GetNextEvent` captures the previous DHGR frame. The VERA build relocates `GetTickCount` and its counter into the shared LC segment to keep the overlay-sensitive main segment within its address limit. Check the linker map after any code changes; segment padding is small.

For normal AppleWin interaction, do not pass `-log`. The VERA-enabled AppleWin fork logs writes to DATA0 when logging is enabled; each full DHGR refresh streams 13,440 framebuffer bytes. The emulator logger should omit DATA0 stream writes so enabling `-log` does not turn a refresh into thousands of file open/close operations.

On 2026-09-30, the local AppleWin Release build was updated to skip DATA0 stream bytes in `C:\dev\AppleWin\source\VERACard\VERACard.cpp` and rebuilt. A normal boot and a 120M-cycle run exited; captured VERA output matched DHGR for the tested boot/event frame. Automated mouse input did not reliably open a folder window. A debugger screenshot from the first break-on-BRK run showed AppleWin paused at PC `$0000`; the auto-run script had enabled the BRK breakpoint but omitted the `G` command, so it had not started guest execution. The script must set the breakpoint *and* resume; capture a new screenshot after the guest actually stops on BRK before diagnosing the crash.

## AppleWin run and verification

The VERA-enabled AppleWin build currently supports the card in slot 2 or slot 4. Use slot 2 for the verified configuration. Pass the empty HDD1 argument as part of one raw argument string:

```powershell
$args = '-no-di -s2 vera -h1 "" -d1 "" -h2 "" -d2 "" -d3 "C:\dev\a2d\vera-mirror\images\A2D-vera-mirror.hdv" -power-on'
Start-Process -FilePath 'C:\dev\AppleWin\Release\AppleWin.exe' -ArgumentList $args -WorkingDirectory 'C:\dev\a2d'
```

Verification captures are not committed (they are ~4 MB of binaries). Generate
your own with the `-load-state` / `-screenshot-and-exit` combination below, then
verify a captured run against its matching save-state and VRAM dump:

```powershell
python vera-mirror\tools\verify_vera.py vera-mirror\captures\vera_working.sav vera-mirror\captures\vera_working.vram
```

A passing result reports that all 192 DHGR rows match. Verify window redraws interactively; earlier headless input-injection runs stalled after opening a folder and did not provide reliable evidence.

To capture an actual BRK, use an AppleWin auto-run debugger script containing
`b` (set the BRK breakpoint) followed by `G` (resume). AppleWin should then stop
only when the guest reaches a BRK:

```text
b
G
```

## Debug session — 2026-10-05: interactive mirroring failure and crash

> Superseded. Kept as a record of what was tried. Items #9 and #10 blamed
> Language Card bank selection; that theory was wrong — the LC bank was already
> correct at the fault — and both "fixes" are still in the tree but are not why
> the crash went away. See the 2026-10-07 sessions below for the real cause.
> Item #6's menu-sync changes are also still in the tree, but had never been
> pixel-verified.

### Symptoms (user reported)

Testing in apple2ts with `slot2=vera`:
- Clicking a menu: DHGR → VERA mirroring does NOT update.
- Double-clicking the right-side disk to open a window: no VERA update AND system crash.

### Event and rendering flow (confirmed correct)

```
MainLoop
  GetNextEvent             ← returns event kind in A
  vera_mark_dirty          ← sets vera_need_blit=1 if event ≠ no_event
  HandleClick/HandleKeydown
  jmp MainLoop
    ValidateWindows
    UpdateMenuItemStates
loop:
    SystemTask             ← increments tick; periodically sets vera_need_blit=1
      vera_present         ← if vera_need_blit=1: calls vera_blit, clears flag
```

`vera_present` is always called from `SystemTask` (line 267 in `main.s`) via
`JSR_TO_AUX ::vera_lc::vera_present`. This sets RAMRDON so that `vera_present`'s
direct `jsr aux::vera_blit` correctly reads AUX memory.

`hires_table_hi` in mgtk.s stores **relative page offsets ($00–$1F)**; `vera_row_addr`
adds `$20` to form the correct DHGR page 1 high byte ($20–$3F). This is intentional
and correct.

### Root cause: `vera_blit` left 80STORE ON and did not save/restore softswitches

Before the fix, `vera_blit` (`driver/vera_drv.s`):
1. Wrote `sta SET80STORE` to enable 80STORE.
2. Never restored 80STORE or PAGE2 after the blit finished.

`vera_blit` is called from `vera_present`, which is called from `SystemTask`, which
runs during nested event loops (scrollbar tracking, drag operations, disk-open
progress). If a ProDOS MLI call or other code ran immediately after a `SystemTask`
tick that triggered `vera_blit`, the leftover `SET80STORE=ON` state could redirect
`$2000–$3FFF` memory accesses to AUX RAM, corrupting the caller's data → crash.

The same residual state caused unpredictable behavior after every interactive
redraw, explaining why VERA updates appeared to fail.

### Fix applied (2026-10-05)

`driver/vera_drv.s` — `vera_blit` now:
- Reads `RD80STORE` ($C018) and `RDPAGE2` ($C01C) into two scratch bytes before
  the blit to snapshot the caller's softswitch state (bit 7 = flag value; no
  side effects on read).
- Clears 80STORE unconditionally after the blit (`sta CLR80STORE` = $C000 write).
- Conditionally restores PAGE2 (`sta HISCR` if PAGE2 was ON).
- Conditionally restores 80STORE (`sta SET80STORE` if it was ON).
- Two new data bytes (`save_80store`, `save_page2`) added inside `vera_blit`;
  AUX segment padding reduced from $0046 to $0023—still within budget.

Build verified clean (exit 0, all segment sizes within limits) after the fix.

### Resolved investigations & root cause analysis

**1. `DC_VIDEO = $91` verified correct:**
Cross-referenced against `C:\dev\AppleWin\VERA.md` and apple2ts `src/worker/devices/vera/video.ts`:
- bits 1:0 = `%01` → Output mode 1 = VGA (0=disabled, 1=VGA, 2=NTSC, 3=RGB)
- bit 3 = 0 → non-interlaced
- bit 4 = 1 → **Layer 0 ENABLE** (bit 4 is Layer 0 enable; earlier speculation that bit 1 was Layer 0 was mistaken)
- bit 5 = 0 → Layer 1 disable
- bit 6 = 0 → Sprites disable
- bit 7 = 1 → Current field flag
`$91` correctly enables Layer 0 and selects VGA progressive scan.

**2. `L0_CONFIG = $04` verified correct:**
Cross-referenced against `C:\dev\AppleWin\source\VERACard\VERAVideo.cpp`:
- bits 1:0 = `00` → color depth 1 bpp (1 bit per pixel)
- bit 2 = 1 (`$04`) → **bitmap mode** (`(m_reg_layer[layer][0] & 0x4) != 0`)
- bits 5:4 = `00` → map width (ignored in bitmap mode)
- bits 7:6 = `00` → map height (ignored in bitmap mode)
Combined with `L0_TILEBASE = $01` (bit 0 = 1 → width 640), this correctly configures 640x480 1bpp bitmap mode.

**3. apple2ts VERA tab refresh mechanics:**
Examined `C:\dev\apple2ts\src\ui\panels\vera\veratab.tsx` and `vera.ts`:
- The emulator steps the VERA core per cycle and calls `video_update()` on every 60Hz frame completion.
- `veratab.tsx` polls `handleGetVeraFrame()` on every browser `requestAnimationFrame` and copies the framebuffer to `<canvas>` with `putImageData`.
- Standby mode only triggers if `(dcVideo & 3) === 0` (output mode disabled). With `$91 & 3 == 1`, video output is permanently active.
- Toggling DC_VIDEO is NOT required to trigger screen redraws.

**4. Root cause for menus/windows not mirroring to VERA:**
- **Problem**: `vera_need_blit` was only set to 1 in `main.s` immediately after `GetNextEvent` (before dispatch).
- When a user clicked a menu, folder, or disk icon, `HandleClick` ran. During disk access, dialog handling, or menu interaction, nested loops repeatedly called `SystemTask`.
- On the very first `SystemTask` call, `vera_present` saw `vera_need_blit == 1`, blitted the frame (which was still the old screen from before the action), and reset `vera_need_blit = 0`.
- Once `HandleClick` finished reading the disk and drawing the newly opened window or updated menu state, it returned to `MainLoop`.
- At `MainLoop`, `vera_need_blit` was already 0. Unless an idle periodic clock tick occurred seconds later, the newly drawn window was **never blitted to VERA**, leaving VERA stuck on the pre-click image.
- **Fix**:
  - Added `lda #1 / sta ::vera_lc::vera_need_blit` directly at the entry of `MainLoop`. Any action returning to the main event loop (opening/closing windows, menu clicks, shortcuts, disk changes) immediately marks the frame dirty so the subsequent `jsr SystemTask` flushes the finished screen to VERA.
  - Routed completion of `MGTK::EventKind::update` through `MainLoop` instead of skipping to `loop`, ensuring repaints also flush.
  - Removed the premature pre-dispatch dirty hook to save 9 bytes in `$4000-$5000`, maintaining safety margin before `OVERLAY_BUFFER` (`$5000`).

**5. MainLoop event dispatch regression & freeze fix:**
- In commit `a25fc78c`, replacing `bne loop` with `jmp MainLoop` at the end of the event dispatch loop caused any unhandled event (specifically `kEventKindNoEvent = 0`) to loop back to `MainLoop` from the top.
- This triggered continuous execution of `ValidateWindows`, `UpdateMenuItemStates`, and `vera_blit` (13,440 VERA writes per frame) on every tick while idle (~30+ frames/sec, 400,000+ writes/sec in apple2ts).
- This 100% CPU lockup starved the emulator worker thread, causing Apple2TS to freeze and preventing the VERA canvas from receiving updated framebuffers.
- **Fix**: Restored `bne loop` after update check. When an `MGTK::EventKind::update` occurs, `ClearUpdatesSkipGet` repaints the window, sets `vera_need_blit = 1`, and loops to `loop:`, where `SystemTask` flushes the new window to VERA. When idle (`no_event`), execution branches to `loop:` without re-running `MainLoop` or blitting, consuming 0% idle CPU.
- Added explicit `vera_need_blit = 1` in `AboutDialogProc` before its modal event loop so modal dialogs flush to VERA immediately.
- Refactored `vera_blit` softswitch setup and restore to match canonical MGTK `InterruptHandler` pattern: access `LOWSCR` before `SET80STORE` on entry, and access `LOWSCR` before `CLR80STORE` on exit.

**6. Modal menu synchronization between DHGR and VERA:**
- **Problem**: When clicking a menu in the menu bar, the drop-down menu appeared on the left (native DHGR) but was completely absent on the right (VERA), leaving only the menu bar and cursor.
- **Root cause**: `MGTK::MenuSelect` (`MenuSelectImpl` in `src/mgtk/mgtk.s`) runs an internal modal tracking loop in auxiliary RAM. When a menu opens, `ShowMenu` draws the dropdown rectangle and items on DHGR. When the user releases the mouse or clicks an item, `RestoreMenuSavebehind` immediately erases the menu from DHGR before `MenuSelect` returns to DeskTop. Because DeskTop's main loop only blits *after* actions return, VERA never captured the menu while it was open.
- **Fix**:
  - Overlaid `mgtk.s` in `vera-mirror/src/mgtk/mgtk.s`.
  - In `MenuSelectImpl::imb_change`: added `jsr ::aux::vera_blit` right after `jsr ShowMenu` completes drawing the menu and items.
  - In `MenuSelectImpl::imi_change`: added `jsr ::aux::vera_blit` when the highlighted menu item changes during hover.
  - In `UnhiliteCurMenuItem`: added `jmp ::aux::vera_blit` when an active highlight is removed.
  - In `RestoreMenuSavebehind`: tail-called `::aux::vera_blit` after `ShowCursorImpl` so menu closing immediately erases from VERA and restores the background.
  - In `vera_drv.s`: guarded `vera_blit` with `vera_enabled` check.
**7. Window Opening Synchronization & Full HDV Image Support:**
- **Problem**:
  1. Double-clicking a disk icon created a file window on native DHGR (left), but VERA (right) never displayed the window and the system froze.
  2. Clicking "Apple menu -> About This Apple II" prompted "Please insert the system disk" because the 140KB floppy image (`.po`) omitted system modules like `THIS.APPLE`.
- **Root causes**:
  1. `OpenWindowForIcon` and `OpenWindowForPath` call `OpenWindowImpl`. Inside `OpenWindowImpl`, attempting an inline `JSR_TO_AUX aux::vera_blit_now` jumped into Language Card Bank 1 (`$D000`), but during/after window entry creation, `LCBANK2` or inconsistent softswitch states caused `$D000` to execute `00 00` (`BRK`), halting the CPU with a monitor beep.
  2. At the end of `MainLoop`, `bne loop ; always` relied on status flags. After an `update` event, `ClearUpdatesSkipGet` returned with Z=1, causing the CPU to fall through into `counter: .byte 0` (`BRK 00`).
  3. The 140KB `.po` image is truncated to fit on a 5.25" floppy, leaving out `MODULES/THIS.APPLE`, desk accessories, and system utilities.
- **Fixes**:
  1. In `vera-mirror/src/desktop/main.s`: changed `bne loop ; always` at line 171 to unconditional `jmp loop ; always`.
  2. In `vera-mirror/src/desktop/main.s`: reverted `OpenWindowImpl` back to `jmp DrawCachedWindowHeaderAndEntries` (safe tail-call return to DeskTop event loop). The window display is naturally and safely blitted to VERA by `SystemTask` -> `vera_present` at the top of `loop:` in `MainLoop`.
  3. Created `vera-mirror/images/A2DeskTop-base.hdv` and `vera-mirror/images/A2DeskTop-VERA.hdv` (800KB raw ProDOS hard disk volume, 819,200 bytes) containing the complete DeskTop 1.6 distribution (`MODULES/DESKTOP`, `MODULES/THIS.APPLE`, `APPLE.MENU/`, `EXTRAS/`, `SAMPLE.MEDIA/`).
  4. Updated `vera-mirror/tools/inspect_prodos.py` and `vera-mirror/build.py` to automatically inject `desktop.built` into both `A2DeskTop-VERA.po` and `A2DeskTop-VERA.hdv`.
**8. VERA Slot 2 Addressing, Memory Banking Stability & Browser Cache Fix:**
- **Problems**:
  1. Window opening on native DHGR completed, but VERA remained frozen on the desktop pattern without rendering the window, followed by a speaker beep and crash.
  2. The browser drive indicator showed `*A2DeskTop-VERA.hd` with a red asterisk, persisting old buggy code across page reloads.
- **Root causes**:
  1. **Slot 4 vs Slot 2 mismatch**: `V_DATA0` in `driver/vera_drv.s` was hardcoded to `$C403` (Slot 4), sending all blitted pixels into unmapped slot space instead of Slot 2 (`$C203`).
  2. **Aux RAM code execution and `RAMRD` conflict**: `vera_drv.s` is linked into `SegmentDeskTopAux` (`$BD56`). `vera_blit` attempted to restore `save_ramrd` via `sta RAMRDOFF` right before exiting. Because the 6502 PC was at `$BDA0` in Aux RAM, switching `RAMRDOFF` caused the CPU to immediately fetch the next opcode from Main RAM at `$BDA1` (which contains uninitialized/buffer data), crashing into the monitor with a speaker beep.
  3. **Stray `RAMWRTOFF` in `vera_patch_sites`**: In `driver/vera_lc.s`, `vera_patch_sites` executed `sta RAMWRTOFF`, disabling Aux RAM writes for subsequent Language Card operations.
  4. **Browser `localStorage` Disk Persistence**: Apple2TS stored modified/dirty disk images in `localStorage` under `GAME_DATA-DATA`. `driveprops.ts::handleSetDiskFromURL()` loaded `state.data.buffer` from `localStorage` whenever present, bypassing `fetch()` and repeatedly booting stale disk binaries even after recompilation.
- **Fixes**:
  1. In `vera-mirror/driver/vera_drv.s`: changed default `V_DATA0` to `$C203` (Slot 2).
  2. In `vera-mirror/driver/vera_drv.s`: removed `save_ramrd` and `save_ramwrt` switching on exit from `vera_blit`. The caller relay (`CallMainToAuxImpl` at Language Card `$D000`) already provides safe, canonical `BankInAux` / `BankInMain` framing.
  3. In `vera-mirror/driver/vera_lc.s`: removed stray `sta RAMWRTOFF` from `vera_patch_sites`.
  4. In `vera-mirror/src/desktop/main.s`: guarded `vera_check_present` with `bit RDBNK2 : bmi :+` to ensure LC Bank 1 is active before calling `$D000`.
  5. In `apple2ts` (`driveprops.ts` and `diskdrive.tsx`): added `?fresh=1` / `?nocache=1` URL query parameter support to bypass and clear `localStorage` disk caching, and ensured `ejectDisk` clears `GAME_DATA-DATA`.
**9. Language Card Bank 2 Collision & Crash on Window Opening Fix:**
- **Problem**:
  When double-clicking volume or folder icons, native DHGR opened and displayed the window, but VERA remained frozen on the desktop background, followed by a monitor drop / speaker beep and freeze.
- **Root causes**:
  1. **LC Bank 2 Collision**: DeskTop stores directory `FileRecords` in Aux Language Card Bank 2 (`$D000-$DFFF`). When opening a folder or volume window, DeskTop switches to `LCBANK2`.
  2. In `main.s`, `CallMainToAuxImpl` and all VERA driver helpers (`vera_copy_dhr_row`, `vera_mul80`, `vera_row_addr`, `vera_set_zp`) reside in `SegmentDeskTopLC` in **Aux Language Card Bank 1**.
  3. When `vera_check_present` skipped blits if `RDBNK2` was active (`bit RDBNK2 : bmi :+`), VERA never updated during or after window creation.
  4. If `CallMainToAuxImpl` ($D000) or any VERA LC helper was called while `LCBANK2` was active, the 6502 jumped into directory `FileRecords` data instead of code, hitting `$00` (`BRK`), dropping into the Apple II System Monitor with a speaker beep, and halting.
- **Fixes**:
  1. In `vera-mirror/src/desktop/main.s` (`vera_check_present`): saved `RDBNK2`, write-banked in `LCBANK1` (`bit LCBANK1 : bit LCBANK1`) and ensured `ALTZPON` before invoking `JSR_TO_AUX ::aux::vera_blit`, then restored `LCBANK2` if it was previously active.
  2. In `vera-mirror/driver/vera_drv.s` (`vera_blit`): saved `RDBNK2` and write-banked `LCBANK1` on entry, and restored `LCBANK2` on exit if it was previously active, protecting callers in both Main and Aux RAM.
**10. Fatal Anonymous Label Register Corruption & LC Bank 2 Return Crash Fix:**
- **Problem**:
  Double-clicking the `A2.DeskTop` volume or folder icons still caused an immediate speaker beep, dropped into the System Monitor with a `BRK` instruction, and halted the machine.
- **Root causes**:
  1. **ca65 Anonymous Label Forward Jump Clashing with Register Restore**:
     In `vera-mirror/src/desktop/main.s` (`vera_check_present`), the check for `vera_need_blit` was:
     ```ca65
     .proc vera_check_present
             lda     vera_need_blit
             beq     :+
             ...
     :       saved_x := *+1
             ldx     #SELF_MODIFIED_BYTE
             saved_y := *+1
             ldy     #SELF_MODIFIED_BYTE
             rts
     ```
     In ca65, `beq :+` resolved to the *first forward* anonymous label `:+`, which was positioned directly at `saved_x`!
     When `vera_need_blit == 0` (which is >95% of all calls in `MainLoop` and `SystemTask`), `stx saved_x` / `sty saved_y` was never executed. `beq :+` branched straight into `ldx/ldy`, loading uninitialized / stale garbage into `X` and `Y` across normal DeskTop GUI processing. Subsequent indexed operations (`window_table,x`, etc.) jumped into garbage memory containing `$00` (`BRK`), sounding the monitor beep.
  2. **Language Card Return-to-Data Crash in `vera_blit`**:
     `CallMainToAuxImpl` resides in **Aux LC Bank 1** at `$D000`. When `JSR_TO_AUX ::aux::vera_blit` is invoked, the 6502 stack contains the return address `$D00C` (where `jmp BankInMain` resides in LC Bank 1).
     When `save_bnk2` in `vera_blit` restored `LCBANK2` prior to executing `rts`, the 6502 popped `$D00C` and fetched the next opcode from **LC Bank 2** instead of Bank 1. In Bank 2, `$D00C` is directory `FileRecords` data containing `$00`, which the CPU immediately executed as `BRK`, sounding the monitor beep.
- **Fixes**:
  1. In `vera-mirror/src/desktop/main.s`: changed `beq :+` to an explicit `beq .done`, where `.done: rts` bypasses register restoration entirely when `vera_need_blit == 0`, leaving caller registers `X` and `Y` completely intact.
  2. In `vera-mirror/driver/vera_drv.s`: removed all LC banking code (`save_bnk2`, `LCBANK1`, `LCBANK2`) from `vera_blit`. `CallMainToAuxImpl` framing is safely contained in LC Bank 1, and `vera_check_present` runs in Main RAM (`$AFxx`), which is the only place LC banking should be switched and restored around the relay call.

## Debug session — 2026-10-07: real root cause found (headless repro)

Fixes #9 and #10 chased Language Card bank selection, but the banks were never the
problem. The crash is a **memory collision inside the LC segment**, and it is
reproducible headlessly.

### Repro harness

`C:\dev\apple2ts\src\worker\devices\vera\repro_disk.test.ts` boots
`vera-mirror/images/A2DeskTop-VERA.hdv`, double-clicks the `A2.DeskTop` icon and asserts
the window opens with no `BRK`. Notes for anyone extending it:

- Enable the mouse in **slot 5** (`enableMouseCard(true, 5)`), not slot 4. Probing
  `0xC086 + slot*0x10` for a non-zero mode byte finds the slot the guest actually
  initialized; `mgtk.s` sets `mouse_firmware_hi` from its own probe.
- Wait on the guest's state, not cycle counts: `no_mouse_flag` (`$85BC`) becomes 0
  when `INITMOUSE` finishes, and `cursor_pos` (`$6085`/`$6087`) changes when a move
  is picked up. Sampling earlier reads uninitialized memory.
- Do **not** wait for a `button_up` event. apple2ts never sets the mouse card's
  `BUTTON0_PREV` bit on release, so a2d never reports one and waiting blows the
  double-click interval (`dblclick_speed`, default 1200 ticks).
- Between the two presses, write `CMD.READ` (1) to the card's command register
  (`$C0DA` for slot 5). That runs the PREV-bit bookkeeping so the second press
  reads as a fresh edge instead of "still held".
- Watch out for `s6502.SP` in apple2ts `doBrk` — the field is `s6502.StackPtr`, so
  the BRK handler throws before logging the PC. Detect opcode `$00` yourself and
  stop before executing it.

### Symptom

Double-click the disk icon, the window draws on DHGR, then the next VERA blit
executes `BRK` (monitor beep).

### Fault trace

`vera_blit` (`$BD6F`) does `jsr $F236` = `jsr ::vera_lc::vera_set_zp`. At that
moment `$F236` held `$00`. One blit earlier the same byte held `$AD` (the real
`lda $BF4A`), and by blit #4 `$F290` held `$65` — ASCII, not code.

A watchpoint on `$F236` pinned the writer to `STA ($06),Y` at `$7573`, from
`copy8 name_tmp,x, (icon_entry),y` in `_FindIconDetailsForIconType`. `icon_entry`
pointed at `$F224`.

### Root cause

`vera-mirror/src/desktop/lc.s` emitted, in this order:

```asm
        .include "res.s"
        .include "../../vera/driver/vera_lc.s"
```

`res.s` **ends** with:

```asm
icon_entries:
        .assert ($10000 - *) >= (kMaxIconCount+1) * .sizeof(IconEntry), error, ...
```

`icon_entries` is the IconTK heap. It lives at the top of the `$E000-$FFFF`
language-card window — the region that is **not** bank-switched on a IIe — and it
grows from its label up to `$FFFF`. Emitting `vera_lc.s` *after* `res.s` therefore
placed `vera_set_zp`, `vera_init`, `vera_upload_palette`, `vera_row_addr`,
`vera_mul80`, `vera_shl_row`, `vera_patch_sites` and `vera_patch_main_slot` at
`$F214-$F2F7`, **inside the heap**.

Double-clicking a disk allocates `IconEntry` structures from `$F224` upward and
overwrites the VERA routines. The window still draws correctly on DHGR because the
icon code itself is intact. The next `vera_blit` then `jsr $F236` into zeroed
memory, executes `$00`, and drops to the monitor with a beep.

This also explains the AGENTS.md #10 "still crashes" report and why no amount of
`LCBANK1`/`LCBANK2` juggling helped: `BSRBANK2` was already false (bank 1 selected)
at the fault, so the bank theory could not apply.

### Fix applied

Moved `.include "../../vera/driver/vera_lc.s"` **before** `.include "res.s"` in
`vera-mirror/src/desktop/lc.s`. The VERA code now lands at `$D2BE-$D3FF`, inside the
bank-switched `$D000-$DFFF` region, and `icon_entries` moved up to `$F2F7` with
3336 bytes available.

The `.assert` in `res.s` still passes: `kMaxIconCount` is 127, `.sizeof(IconEntry)`
is 24, so 128 x 24 = 3072 bytes are required and 3336 are available (the LC segment
still ends at `$F2F7`, padding `$0009`).

### Verification

`repro_disk.test.ts` now passes: window opens (`windowOpens=1`), 22 blits complete,
no `BRK` and no monitor entry. Before the fix it died on blit #4.

## Debug session — 2026-10-07 (2): LC bank hygiene

Neither of the following caused the crash above, but both were latent faults.

### `vera_check_present` banked LC before selecting ALTZP

`vera-mirror/src/desktop/main.s` did:

```asm
        lda     RDBNK2
        sta     saved_bnk2
        bit     LCBANK1
        bit     LCBANK1
        sta     ALTZPON
```

`$C08B` applies to whichever LC `ALTZPON` currently has mapped. Banking first
therefore selected the bank on the **Main** LC and then switched to an Aux LC
that could still be on bank 2. Every other a2d site (`main.s:3421`,
`readwrite_settings.s`, `mgtk.s:4810`) does `sta ALTZPON` first.

Fixed by saving/restoring ALTZP around the blit, with `sta ALTZPON` first. The
restore has to happen **before** the final `rts`, otherwise the return address
is popped from a different 6502 stack than the one that pushed it.

The save must be `lda RDALTZP`, **not** `bit RDALTZP`. `BIT` only ANDs the status
into A. (a2d's `readwrite_settings.s` does use `bit RDALTZP`, but there it relies
purely on the resulting **N flag**, carried across the body via `php`/`plp` — the
accumulator is discarded.) Getting this wrong stores 0 every time and turns ALTZP
**off** on every return, which breaks MGTK; that showed up as an immediate crash
at `$C4B` in the repro.

### `bit saved_bnk2 / bpl` tested the wrong register

`BIT` leaves N/Z from `A AND [mem]`, so the conditional restore of `LCBANK2`
depended on whatever happened to be in A rather than on the saved byte. Changed to
`lda saved_bnk2 / bpl`.

### MGTK menu paths blit without banking

The four `jsr ::aux::vera_blit` calls added in #6
(`MenuSelectImpl::imb_change`, `imi_change`, `UnhiliteCurMenuItem`,
`RestoreMenuSavebehind`) run in Aux RAM without going through
`CallMainToAuxImpl`, so nothing had selected LC bank 1. If `LCBANK2` was still
active, `vera_blit`'s `jsr ::vera_lc::vera_set_zp` would execute directory
`FileRecords` at `$D000`.

Added `vera_blit_now` in `driver/vera_drv.s` ($BDCA) which saves `RDBNK2`, banks in
`LCBANK1`, calls `vera_blit`, then restores `LCBANK2` only if it was in use. All
four call sites now use it. It deliberately does **not** touch RAMRD/RAMWRT:
MGTK wants AUX, and `vera_blit` leaves them there. It also cannot be moved back
into `vera_blit` itself, because the `CallMainToAuxImpl` path pops its return
address out of LC bank 1 — restoring bank 2 there is exactly the AGENTS.md #10
crash.

### Verification

`repro_disk.test.ts` now has two cases, both passing:

- `double-click disk icon opens a window without BRK` — `windows=1`, 22 blits.
- `menu clicks blit to VERA without BRK` — `menuSelects=1`, `menuRestores=1`,
  `blitsNow=2`, so `vera_blit_now` is exercised via `imb_change`/`imi_change`
  and `RestoreMenuSavebehind`. The menu is dismissed with Escape because
  apple2ts never produces a `button_up`, and a mouse release will not close it.

Segment padding after the change: aux `$005D` -> `$0041`, main `$0066` -> `$0057`,
LC unchanged at `$0009`.

Note: `src/worker/devices/vera/vera.test.ts` has a pre-existing failure
("read real sd.img sectors") that is unrelated — it reads `C:/dev/a2vera/sd.img`
and checks a CMDR-DOS header via the VERA SPI device.

### Build-time guards against the heap collision

Three `.assert`s now make the collision above impossible to reintroduce silently:

1. `driver/vera_lc.s` (end of file): `vera_lc_end < $E000`.
2. `src/desktop/lc.s` (after the VERA includes): `lc_vera_code_end < $E000`.
3. `src/desktop/lc.s` (after `.include "res.s"`): `* = icon_entries`.

`$E000` is the boundary that matters: `$D000-$DFFF` is bank-switched, while
`$E000-$FFFF` is the common half of the LC window where the `icon_entries` heap
lives. Guard 3 is exact rather than heuristic — `*` is still `icon_entries` right
after the include, so it trips on the very first byte emitted past `res.s`.

All three were verified to fire, not just to pass:

- Restoring the old include order (VERA code after `res.s`) trips all three.
- Appending a single `.byte` after `res.s` in the correct order trips guard 3.

They emit no bytes, so the rebuilt image is byte-identical to the one verified
interactively (`.hdv` SHA256 `2F84F5B2D45034059A77DB13414D3F58172310A0FC075E196A81C79009673A78`).

## Memory map (measured, `python vera-mirror/build.py`)

Per-segment run address, declared size and padding, as printed by the build:

```
Segment: SegmentLoader         addr: $2000  len: $0200  offset: $000200  padding: $004B
Segment: SegmentDeskTopAux     addr: $4000  len: $8000  offset: $000400  padding: $0044
Segment: SegmentDeskTopLC      addr: $D000  len: $2300  offset: $008400  padding: $0009
Segment: SegmentDeskTopMain    addr: $4000  len: $7000  offset: $00A800  padding: $0021
Segment: SegmentInitializer    addr: $0800  len: $0800  offset: $011800  padding: $00A2
Segment: SegmentInvoker        addr: $0290  len: $0160  offset: $012000  padding: $0002
Segment: OverlayFormatErase    addr: $0800  len: $1000  offset: $012200  padding: $010B
Segment: OverlayShortcutPick   addr: $5000  len: $0700  offset: $013200  padding: $0071
Segment: OverlayFileDialog     addr: $B600  len: $0900  offset: $013A00  padding: $00A8
Segment: OverlayFileCopy       addr: $B500  len: $0100  offset: $014400  padding: $0085
Segment: OverlayShortcutEdit   addr: $B200  len: $0400  offset: $014600  padding: $0051
```

`SegmentDeskTopAux` padding is only `$0044` (68 bytes) because the VERA display
driver lives in the tail of the aux segment. Removing the VERA driver is what
makes room for the SD driver in the `a2d-verasd` goal.

`SegmentDeskTopLC` is split by the IIe language-card hardware, and the split
matters:

```
$D000-$DFFF  bank-switched  (a separate copy per LC bank 1 / bank 2)
$E000-$FFFF  LC common      (one copy, shared by both banks, never swapped)
```

`$E000-$FFFF` is **entirely** the `icon_entries` heap. `src/desktop/res.s:2051`
grows it upward to `$FFFF`, and two asserts in `src/desktop/lc.s` close off any
possible gap:

```
lc.s:635  .assert lc_vera_code_end < $E000, error,
          "VERA code in SegmentDeskTopLC must stay below $E000
           - $E000-$FFFF is the LC-window icon_entries heap"
lc.s:644  .assert * = icon_entries, error,
          "nothing may be emitted after res.s in SegmentDeskTopLC
           - it would land inside the icon_entries heap"
```

So no byte of LC common memory can be reserved without shrinking `kMaxIconCount`,
and shrinking it does not help: the heap always grows *up to* `$FFFF`, so `$FF00`
is inside the heap regardless of where the heap starts.

## VeraSD-IFS coexistence investigation

Goal was a single a2d image that shows the VERA SD card as a normal ProDOS
volume. The driver itself is done and verified; the blocker is placement.

**What works.** A separate branch (`verasd`, which builds `A2D-verasd.hdv`) assembles
the upstream VeraSD-IFS-ProDOS driver and
installer relocated into LC bank 2. Upstream `verasd_drv.asm` and `verasd_gate.asm`
are used **verbatim**; the only change is the gate's `jsr $D400` operand, which
`build.mjs` rewrites to the actual driver load address. Verified on a plain ProDOS
2.4.3 volume: `PRINT CHR$(4);"BRUN VERASD.SYSTEM"` reports `VERASD INSTALLED` and
`CATALOG /VERASD` lists 65,535 blocks. Driver is 681 bytes, gate 80 bytes,
installer 2,392 bytes — byte-for-byte upstream's sizes.

**Two bugs that were found and fixed along the way, both worth remembering:**

1. The gate's hardcoded driver entry address drifted from the installer's copy
   destination (`DRV_BANK2_ADDR = $DD40` vs `DRV_BODY = $DD00`). The gate jumped
   into the middle of the driver and executed data, which surfaced only as
   `VERASD FAILED`. `build.mjs` now checks the *assembled* gate bytes for
   `JSR <DRV_ADDR>` instead of trusting the source.
2. The gate's `load_buffer` / `store_buffer` routines were removed on the
   incorrect assumption that a2d puts ProDOS's block buffer in ordinary RAM. They
   are the LC bank 1 <-> bank 2 bridge and ProDOS's buffer *is* in language-card
   space. Removing them hung the machine on the first buffer read. `build.mjs`
   now assembles the gate first and fails if `load_buffer` / `store_buffer` are
   missing, because the driver's `GATE_LOAD` / `GATE_STORE` equates resolve to them.

**Why it still does not coexist.** VeraSD puts its driver in LC bank 2 and needs a
gate in LC *common* memory, because ProDOS dispatches the device with bank 1
selected. Verified experimentally: deleting the two `lda $C083` (select bank 2)
instructions from the top of the gate makes the machine crash and reboot in a
loop, so the bank selection is genuinely required. But LC common is 100% the
`icon_entries` heap, so there is nowhere to put an 80-byte gate.

**The insight for the next goal:** the gate exists *only* because the driver's
code sits in bank-switched memory. If the driver lives in main or aux RAM — single
bank, no banking — ProDOS can jump straight into it with no gate, and the
bank-1 accesses for ProDOS's buffer become a local detail inside the driver.
That removes the `$E000-$FFFF` blocker entirely. It needs ~681 contiguous bytes in
main or aux RAM; dropping the VERA driver frees roughly 400 bytes of the aux tail
(`$0044` padding plus what the driver occupied), so some further reduction is
probably still required.

**Boot-time installation is also unsolved.** The installer's final `rts` does not
fit a2d's launch protocol: `src/desktop/main.s:1758` (`launch`) ends in
`copy16 #INVOKER, reset_and_invoke_target` / `jmp ResetAndInvoke`, i.e. a2d
*soft-resets* and re-invokes whatever it launched. Running the installer from
`/Startup.Items/` therefore loops forever (verified: the desktop redraws in a
loop). `/Startup.Items/` is for long-running programs such as `BASIC.SYSTEM`.
The planned fix is a boot-block that loads and runs the installer before ProDOS;
the insertion point is block 0 offset `$0118` (`CLI` / `JMP $2000`) and block 1 is
entirely free. This was not attempted because the gate placement blocker made it
moot.

## ProDOS image tooling

Use **cadius**, not hand-written Python. `C:\dev\a2d.bak\tools\cadius.exe`
(v1.4.5). Hand-rolled directory-entry writing corrupted `$0400-$07FF` of the
a2d volume and produced an image that would not boot.

Syntax, taken from `a2d.bak/bin/install:54` and `a2d.bak/bin/manifest`:

```
cadius ADDFILE <image> '/VOLUME/PATH' '<file>#<TYPE><AUX>' --quiet
```

The suffix is six hex digits: type then auxtype. `FF2000` = SYS at $2000,
`062000` = BIN at $2000, `FC0801` = tokenized Applesoft at $0801, `F10642` =
desk accessory. Paths must be volume-qualified (`/A2.DeskTop/...`, not
`/DESKTOP.SYSTEM`). `EXTRACTFILE` / `EXTRACTFOLDER` need a **relative** output
directory; absolute Windows paths fail with "Can't create output folder".

Applesoft BASIC sources are tokenized with
`compileApplesoftBasic` from `C:\dev\veratest\src\applebasic.mjs`. That token
table has 107 entries and covers Applesoft only — `BRUN` and `CATALOG` are
ProDOS BASIC commands and are absent, so they must be used inside string literals
with a monitor redirect:

```
10 PRINT CHR$(4);"BRUN VERASD.SYSTEM"
20 PRINT CHR$(4);"CATALOG /VERASD"
```

`a2d` does not run `/STARTUP`: there is no `BASIC.SYSTEM` on the volume and the
boot block only references `PRODOS`. `LOCAL/DESKTOP.FILE` is a saved desktop
state, not a launch list.

`FileRecord` was reduced from 32 to 26 bytes (dropping write-only
`creation_date`, `creation_time`, `header_pointer`), and `ATimes32` was replaced
by a shift-and-add `ATimes26`, with four call sites updated and four
`ASSERT_EQUALS .sizeof(FileRecord), 26` guards added. `kMaxIconCount` was left at
127; no user-visible feature was removed for memory.

## Outstanding work

1. Interactively test the remaining window types — file windows (double-click a
   file icon) and "About This Apple II" — on Apple2TS. Double-clicking the disk
   volume and the Control Panel are confirmed working.
2. Pixel-verify that menus and open windows actually appear on the VERA output.
   The repro asserts only that the blit runs without a fault, not that the
   resulting framebuffer is correct.
3. Confirm SD reads with VeraSD-IFS-ProDOS in the same system while VERA output is active.
4. Repair and re-enable slot auto-detection (`vera_detect`) if slot 2 hardcoding is no longer desired.
5. Validate output on physical VERA hardware.
6. `UnhiliteCurMenuItem` is the one `vera_blit_now` call site the repro cannot
   reach (it needs a `button_up`). It shares the wrapper with the other three,
   so it is covered by construction, but it is not directly asserted.
7. `src/worker/devices/vera/vera.test.ts` in apple2ts has a pre-existing failure
   ("read real sd.img sectors"). Unrelated to this work — it reads
   `C:/dev/a2vera/sd.img` and validates a CMDR-DOS header over the VERA SPI
   device. Worth a look at some point.

## References

- VERA Programmer's Reference: <https://github.com/X16Community/x16-docs/blob/master/X16%20Reference%20-%2009%20-%20VERA%20Programmer's%20Reference.md>
- VeraSD-IFS-ProDOS source: `C:\dev\verasdtool\src\verasd-prodos`
- VERA-enabled AppleWin source and behavior notes: `C:\dev\AppleWin\VERA.md`
- apple2ts VERA device implementation: `C:\dev\apple2ts\src\worker\devices\vera\vera.ts`
- Headless regression test for the crash:
  `C:\dev\apple2ts\src\worker\devices\vera\repro_disk.test.ts` (two cases: disk
  window open, menu click). Lives in the apple2ts repo, not this one.


