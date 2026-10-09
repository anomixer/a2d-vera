# Test build — read this first

```
A2D-verasd.hdv    the a2d desktop image under test
SD-card.img       what to put on the VERA SD card (raw ProDOS, 32 MiB)
```

## One thing to do first: sort the boot directory

`VERASD.SYSTEM` is already the correct file — type **SYS**, auxtype **$2000**,
2594 bytes, sitting in the root (`/A2.DeskTop`) directory. It is built to run
*before* DeskTop, the same way `CLOCK.SYSTEM` already runs before
`DESKTOP.SYSTEM`. But ProDOS runs the **first** SYS file it finds in the boot
directory, and right now `CLOCK.SYSTEM` is ahead of it, so booting will bring up
the desktop without the SD volume.

Open the image with **Copy II Plus** and sort the root directory so
`VERASD.SYSTEM` comes before `CLOCK.SYSTEM` — any sort that puts it first works.
Current order:

```
  A2.DESKTOP      (dir)
  PRODOS          SYS  $0000
  CLOCK.SYSTEM    SYS  $0000     <- currently runs first; must come AFTER VERASD.SYSTEM
  ...
  VERASD.SYSTEM   SYS  $2000     <- needs to move above CLOCK.SYSTEM
```

Copy II Plus can reorder, which is all that is needed — the file type is already
correct in the image.

## What happens after the sort

Boot sequence becomes:

1. ProDOS runs `VERASD.SYSTEM` (2594 bytes at `$2000`).
2. It copies the 681-byte driver to LC bank 2 at `$DD00` and the 80-byte gate to
   LC common at `$FF00`, then loads and runs `CLOCK.SYSTEM`.
3. `CLOCK.SYSTEM` chains to `DESKTOP.SYSTEM` exactly as it normally does.
4. The desktop comes up with the SD card registered as a ProDOS volume.

If you sort it wrong, the desktop simply appears without the SD volume. Nothing
breaks.

## Why the gate is at $FF00 this time

The previous test build put the gate at `$AED1` in main RAM, and it corrupted the
screen and BRKed. `src/desktop/README.md` says memory above ~`$AE00` is used for
file-copy buffers and overlays, so a2d loaded an overlay over the gate and the
next disk access jumped into overlay data. The gate is now in LC common at
`$FF00`: the installer runs before a2d is loaded so that memory is free at the
time, and afterwards the DeskTop language-card segment only reaches `$F2FF` while
the icon heap grows upward from `$F165`, well short of `$FF00`.

## What to report back

- **`VERASD` icon appears on the desktop** — it worked. Open it, list contents,
  COPY a file, double-click a file.
- **Desktop comes up, no icon** — the sort did not take effect, or SD init
  failed. Verify `VERASD.SYSTEM` really is ahead of `CLOCK.SYSTEM`.
- **Corruption / BRK** — tell me what it looked like. The gate problem is fixed,
  so this would be something new.

To run the installer by hand from a monitor or BASIC prompt, bypassing the sort:

```
BRUN /A2.DeskTop/VERASD.SYSTEM
```

It prints `VERASD INSTALLED` on success, or `VERA NOT FOUND` / `VERASD FAILED`.

## If the desktop looks wrong

`vera-mirror/` on branch `vera-mirror` is a separate, working build — plain DHGR
mirrored to the VERA, no SD involved. Compare against it to tell an SD problem
from a display problem.