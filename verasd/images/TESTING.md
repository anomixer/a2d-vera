# Test build — read this first

```
A2D-verasd.hdv    the a2d desktop image under test
SD-card.img       what to put on the VERA SD card (raw ProDOS, 32 MiB)
```

## What to do

1. Write `SD-card.img` to the SD card.
2. Put `A2D-verasd.hdv` on the Apple II as drive 1.
3. Boot.

You should get the a2d desktop. Whether the SD volume appears is the question
this build exists to answer.

## What is known working, and what is not

Verified by running the image under an emulator and reading memory back:

- a2d boots cleanly, no BRK.
- `FinalSetup` opens `/A2.DeskTop/VERASD.SYSTEM` and reads it to `$2000`.
- The installer runs, and its `/RAM` reservation is correctly skipped
  (`did_reserve = 0`).
- It then reaches `detect_vera`, which probes `$C205` in slot 2 and then slot 4.

**Everything after `detect_vera` is untested.** In the emulator it stops there
because there is no real VERA card to answer the probe. On real hardware the
probe should succeed and the installer should go on to `sd_init`, copy the
driver to `$DD00`, write the gate to `$AED1`, and register the device.

So the useful thing to report back is which of these you see:

- **A `VERASD` icon appears on the desktop** — it worked. Then open it, list the
  contents, try a COPY, and try double-clicking a file.
- **It boots to the desktop but there is no `VERASD` icon** — `detect_vera` or
  something after it failed. This is the expected failure if the SD card or the
  driver install did not complete.
- **It hangs or crashes at boot** — something much earlier broke.

If it boots but no icon appears, capture whatever text is on screen. The
installer can also be run by hand from a monitor or BASIC prompt to see its
own message, which distinguishes "no VERA found" from "SD init failed":

```
BRUN /A2.DeskTop/VERASD.SYSTEM
```

It prints `VERASD INSTALLED` on success, or a short failure string otherwise.

## One thing to be aware of

`VERASD.SYSTEM` is stored in the image with ProDOS file type `UNK` rather than
`BIN $2000`. The cadius build in use here rejects its own documented
`#<type><auxtype>` filename suffix, so the type could not be set when the file
was added.

This does not affect a2d. `LoadVeraSDDriver` opens the file and reads the bytes
to `$2000` itself with `MLI OPEN`/`READ`, and ProDOS's `OPEN` is type-agnostic,
so the on-disk type is irrelevant to that path. It only matters if you `BRUN`
the file, in which case ProDOS loads it at `$0800` instead of `$2000` and it
will not run correctly. The a2d path is unaffected.

## If you want to compare

`vera-mirror/` on branch `vera-mirror` is a separate, working deliverable —
plain DHGR mirrored to the VERA, no SD involved. This branch drops the
mirroring to make room for the driver. If the desktop renders wrong here,
compare against the mirror build to tell an SD problem from a display problem.