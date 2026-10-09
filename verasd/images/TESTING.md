# Test build — read this first

```
A2D-verasd.hdv    the a2d desktop image under test
SD-card.img       what to put on the VERA SD card (raw ProDOS, 32 MiB)
```

## Before you boot: two things to set up with Copy II Plus

The installer has to run **before** DeskTop does, the same way `CLOCK.SYSTEM`
already runs before `DESKTOP.SYSTEM`. Right now it is not set up that way, so the
image will boot to the desktop with no SD volume. Two changes fix it:

**1. Move it to the root directory.** It is currently at `/A2.DeskTop`.
ProDOS only looks in the boot directory (root) for a `.SYSTEM` file.

**2. Make it the first SYS file in root, type `SYS`, auxtype `$2000`.**

Right now the root directory is:

```
  A2.DESKTOP     (dir)
  PRODOS         SYS  $0000
  CLOCK.SYSTEM   SYS  $0000     <- ProDOS runs THIS one first
  READ.ME        TXT
  DESKTOP.SYSTEM SYS  $0000
  MODULES        (dir)
  EXTRAS         (dir)
  APPLE.MENU     (dir)
  SAMPLE.MEDIA   (dir)
```

You want `VERASD.SYSTEM` ahead of `CLOCK.SYSTEM`, so that the order becomes:

```
  VERASD.SYSTEM  SYS  $2000     <- runs first: installs the driver
  CLOCK.SYSTEM   SYS  $0000     <- then the normal startup continues
  ...
```

ProDOS runs the first SYS file it finds in the boot directory. `VERASD.SYSTEM`
must be **type `$FF` (SYS)** or ProDOS will skip it entirely — Copy II Plus
will set that when you copy it. Auxtype `$2000` matters because the installer is
assembled to run at `$2000`.

Sort the catalog so the entries land in that physical order. Once
`VERASD.SYSTEM` is in front, boot it and `VERASD.SYSTEM` installs the driver and
then chains to `CLOCK.SYSTEM`, which chains to `DESKTOP.SYSTEM` as it normally
does. If you sort it wrong the desktop simply comes up without the SD volume —
nothing breaks.

## How it is supposed to work

`VERASD.SYSTEM` runs first, before DeskTop is loaded, so language-card common
memory is empty. It copies the 681-byte driver to LC bank 2 at `$DD00` and the
80-byte gate to LC common at `$FF00`, then loads and runs `CLOCK.SYSTEM`.

The gate is in LC common at `$FF00` — upstream's own address — rather than in
main RAM. The earlier test build put it at `$AED1`, which is inside the region
DeskTop uses for file-copy buffers and overlays, so an overlay would land on top
of the gate and the next disk access would jump into overlay data. That is what
caused the screen corruption and BRK. LC common at `$FF00` is safe because the
DeskTop language-card segment only reaches `$F2FF`, and the icon heap grows
upward from `$F165`, well short of `$FF00`.

## What to report back

- **A `VERASD` icon appears on the desktop** — it worked. Open it, list the
  contents, try a COPY, try double-clicking a file.
- **Desktop comes up, no `VERASD` icon** — the installer did not run first, or
  SD init failed. Check that it is really the first SYS file.
- **Corruption or BRK** — tell me what it looked like; that is fixed once the
  gate is in LC common, so it would mean something new.

If you want to see the installer run on its own from a monitor or BASIC prompt:

```
BRUN /A2.DeskTop/VERASD.SYSTEM
```

It prints `VERASD INSTALLED` on success, or `VERA NOT FOUND` / `VERASD FAILED`.

## If the desktop looks wrong

`vera-mirror/` on branch `vera-mirror` is a separate, working build — plain DHGR
mirrored to the VERA, no SD involved. Compare against it to tell an SD problem
from a display problem.