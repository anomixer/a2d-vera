# a2d + VeraSD

**This branch is now stock a2d. No VeraSD integration is needed.**

Paths below are relative to the repository root.

## The finding

a2d and the VeraSD ProDOS driver coexist with **no changes to a2d at all**.
Verified on real hardware:

1. Write `C:\dev\verasdtool\VeraSD-IFS-ProDOS.img` (or `.po`) to the VERA SD card.
2. Run the stock `verasd.system` installer from the SD volume (BRUN).
3. Boot a2d.

The `VERASD` volume appears in the desktop and works: browse, COPY both ways,
double-click files. Stock a2d, stock installer, driver at `$D400`, gate at
`$FF00`.

An earlier stretch of this branch tried to make a2d install the driver itself --
injecting `VERASD.SYSTEM` into the boot directory, relocating the gate and driver,
and rewriting the installer. Every part of that was solving a problem that does
not exist, and the relocated builds were actively broken on hardware. It has been
reverted.

## What was learned along the way (worth keeping)

- **Do not put the driver gate in main RAM.** Placing it at `$AED1` (the tail of
  a2d's main segment) looks free at link time but is not: `src/desktop/README.md`
  says memory above ~`$AE00` is used for file-copy buffers and overlays at run
  time. An overlay lands on the gate, and the next ProDOS dispatch does
  `JMP ($BF26)` into overlay data -- the screen corrupts and the machine BRKs.
  LC common at `$FF00` is safe: a2d's language-card segment only reaches `$F2FF`,
  and the icon heap grows upward from `$F165`, far short of `$FF00`.

- **ProDOS runs SYS files in the boot directory in order, not just the first.**
  The volume has `CLOCK.SYSTEM` before `DESKTOP.SYSTEM`, and both run. This was
  only visible on hardware; an emulator test could not show it because the driver
  install needs a real VERA card to get past `detect_vera`.

- **ProDOS 16 MLI has no "load file to address" call.** The table in
  `src/inc/prodos.inc` runs `CREATE = $C0` .. `GET_BUF = $D3` and stops. There is
  no `$D7`; calling it returns error `$01` (invalid MLI call). a2d uses ProDOS 16
  numbering (`OPEN = $C8`, `ON_LINE = $C5`), not ProDOS 8 (`OPEN = $02`).

- **To run a block driver from within a2d, aux memory must be off.** a2d runs
  with aux banked in, so a bare `jsr $2000` or `jsr $BF00` lands in AUX.
  `MLI_CALL` is safe only because `MLIRelayImpl` does `sta ALTZPOFF` around its
  own `jsr MLI`.

- **`DEFINE_*_PARAMS` emit data, not code.** Putting a parameter block at the top
  of a proc makes the proc's entry point a data block; the CPU then executes it.
  This looked exactly like an unexplained `BRK`, because it walked into a load
  address of `$2000` and executed `$00`.

These were each found the hard way and cost real time. They are recorded here
because the failure modes are non-obvious and would be easy to rediscover.

## Driver location, for reference

Stock installer constants (`C:\dev\verasdtool\src\verasd-prodos\verasd.asm`):

```
DRV_TARGET  = $FF00   gate, LC common
DRV_BODY    = $D400   driver, LC bank 2
```

Driver 681 bytes, gate 80 bytes, installer 2392 bytes -- byte-for-byte upstream
sizes. Nothing needs relocating.