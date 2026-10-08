# a2d + VeraSD-IFS-ProDOS

Paths below are relative to the repository root, not to this directory.

## Goal

DeskTop 1.6 on the Apple II, showing the VERA card's SD card as an ordinary
ProDOS volume: a `VERASD` icon on the desktop, a window you can open and browse,
COPY in both directions, and double-click to launch files.

This branch is plain DHGR. There is no VERA display mirroring here — that lives
on the `vera-mirror` branch, which is a separate deliverable
(`A2D-vera-mirror.hdv`). Dropping the mirroring driver is what makes room for
the SD driver.

Output image: `verasd/images/A2D-verasd.hdv` (not built yet — see Outstanding).

## Current status

**The driver installs and the SD volume reads.** Verified end to end on a plain
ProDOS 2.4.3 volume with a tokenized `STARTUP` that does
`PRINT CHR$(4);"BRUN VERASD.SYSTEM"` followed by `PRINT CHR$(4);"CATALOG /VERASD"`:

```
VERASD INSTALLED
/VERASD
  VERASD.SYSTEM  BIN  6  2392 A=$2000
  BLOCKS FREE: 65507  BLOCKS USED: 28
  TOTAL BLOCKS: 65535
```

`CATALOG /VERASD` succeeding is the real proof: ProDOS dispatched into the
driver, the driver issued SD reads over VERA SPI, and ProDOS's own directory
read of its buffer came back correct.

**Not yet done:** the image is not packaged, the driver is not installed at boot,
and nothing has been run with a2d and the SD card together. See Outstanding.

## Memory map (measured, not inferred)

`make -C src/desktop` prints per-segment padding. From a clean build:

```
Segment: SegmentLoader         addr: $2000  len: $0200  padding: $004B
Segment: SegmentDeskTopAux     addr: $4000  len: $8000  padding: $02F8
Segment: SegmentDeskTopLC      addr: $D000  len: $2300  padding: $019B
Segment: SegmentDeskTopMain    addr: $4000  len: $7000  padding: $0147
Segment: SegmentInitializer    addr: $0800  len: $0800  padding: $00BC
Segment: SegmentInvoker        addr: $0290  len: $0160  padding: $0002
```

Language-card split, which is the whole difficulty here:

```
$D000-$DFFF  bank-switched, 4096 bytes, a separate copy per bank
$E000-$FFFF  LC common, 8192 bytes, one copy shared by both banks
```

All of LC common above the a2d code is the `icon_entries` heap. `src/desktop/res.s`
grows it upward to `$FFFF`, and `src/desktop/lc.s` asserts that nothing is
emitted between the end of `res.s` and the `icon_entries` label, so there is no
gap anywhere in common:

```
lc.s  .assert lc_vera_code_end < $E000, error,
       "VERA code in SegmentDeskTopLC must stay below $E000
        - $E000-$FFFF is the LC-window icon_entries heap"
lc.s  .assert * = icon_entries, error,
       "nothing may be emitted after res.s in SegmentDeskTopLC ..."
```

Confirm the heap's real position from the linker listing rather than trusting
the comments — the `icon_entries:` label assembles at **$F165** with the current
`kMaxIconCount`, and at $F195 with the stock 127.

## Placement, and why the gate is in main RAM

```
main RAM    $AED1-$AF20   gate     80 bytes
LC bank 2   $DD00-$DFA8   driver  681 bytes
LC common   $F165-$FFFF   icon_entries heap, untouched
```

Upstream `VeraSD-IFS-ProDOS` puts its gate in language-card *common* memory,
because the driver lives in bank-switched memory and ProDOS dispatches the
device with bank 1 selected, so something has to force bank 2 before jumping.

That is impossible here: LC common is entirely the `icon_entries` heap, and
shrinking `kMaxIconCount` does not help, because the heap always grows *up to*
`$FFFF` and so always covers any address near the top of common.

But the gate does not need to be in the language card. Its only requirement is
that ProDOS can reach it with `JMP ($BF26)`, and main RAM is directly
addressable from main. So the gate sits at `$AED1` in the tail of a2d's main
segment, still does `lda $C083` twice to select bank 2, and still `jsr`s the
driver. **Verified working.**

This was worth checking rather than assuming. An earlier conclusion that
"VeraSD cannot coexist with a2d" was based on reading the `lc.s` assert
comments and doing arithmetic on `padding`; both were wrong at least once before
the actual addresses were read out of the linker listing.

## Source changes

Three lines, and that is all:

```
src/desktop/main.s        kFileRecordsBufferLen = $1000 -> $0D00
src/toolkits/icontk.inc   kMaxIconCount = 127 -> 103
src/toolkits/icontk.s     free_icon_map 16 -> 13 bytes
```

`file_records_buffer` sits at `$D000` and with `kFileRecordsBufferLen = $1000`
occupies all of bank 2. The assert only demands
`kFileRecordsBufferLen > sizeof(FileRecord) * kMaxIconCount`, so at 127 icons
there were 32 spare bytes against a 681-byte driver. 103 is the largest value
satisfying both `3328 > 32 * kMaxIconCount` and `768 = 4096 - 3328 >= 681`.

**`kMaxIconCount` is not just a capacity constant.** `free_icon_map` in
`icontk.s` is a hardcoded bitmap, one bit per icon, with `$FE` in byte 0 so
icon 0 stays unused, and
`ASSERT_TABLE_SIZE free_icon_map, (::kMaxIconCount + 7)/8`. It has to be edited
in step or the build stops. This is the kind of coupling worth knowing about
before touching it.

This costs icon capacity: windows hold 103 icons instead of 127. The rejected
alternative was shrinking `FileRecord` from 32 to 26 bytes — `creation_date`,
`creation_time` and `header_pointer` are all marked `UNUSED` upstream, and
dropping them gives 26 * 127 = 3302, leaving 794 bytes free with no feature
loss. It was rejected because it touches the buffer length, four index sites,
the FileEntry-to-FileRecord mapping table and adds a hand-written `ATimes26`
multiply, and a mistake there shows up as garbled file names in windows rather
than as a build error.

One more pre-existing bug had to be fixed to build at all, see below.

## VeraSD driver build

`verasd/` assembles the upstream driver with only the load address changed.
Upstream `verasd_drv.asm` and `verasd_gate.asm` are used **verbatim**; the only
edit is `build.mjs` rewriting the gate's `jsr $D400` operand to the actual
driver address. `verasd_a2d_install.asm` is upstream `verasd.asm` with
`DRV_BODY = $DD00` and `DRV_TARGET = $AED1`.

```powershell
node verasd/build.mjs
node verasd/build-installer.mjs
```

Driver 681 bytes, gate 80 bytes, installer 2392 bytes — byte-for-byte upstream's
sizes.

`build.mjs` enforces two things that were both violated at some point:

- The **assembled gate bytes** must contain `JSR <DRV_ADDR>`. Checking the
  source is not enough: the gate's hardcoded driver address once drifted from
  the installer's copy destination (`$DD40` vs `$DD00`), the gate jumped into
  the middle of the driver and executed data, and the only symptom was
  `VERASD FAILED`.
- `load_buffer` and `store_buffer` must exist. They are the LC bank 1 <-> bank 2
  bridge for ProDOS's block buffer, which *is* in language-card space. They were
  once removed here on the incorrect assumption that a2d puts ProDOS's buffer in
  ordinary RAM; without them the machine hangs on the first buffer read. The
  build assembles the gate first so it can resolve the driver's
  `GATE_LOAD`/`GATE_STORE` equates, and fails loudly if either routine is gone.

## ProDOS image tooling

Use **cadius** (`C:\dev\a2d.bak\tools\cadius.exe`, v1.4.5). Hand-written
directory-entry writing corrupted `$0400-$07FF` of the a2d volume and produced an
image that would not boot.

```
cadius ADDFILE <image> '/VOLUME/PATH' '<file>#<TYPE><AUX>' --quiet
```

The suffix is six hex digits, type then auxtype: `FF2000` SYS at $2000,
`062000` BIN at $2000, `FC0801` tokenized Applesoft at $0801, `F10642` desk
accessory. Paths must be volume-qualified. `EXTRACTFILE` and `EXTRACTFOLDER`
need a **relative** output directory; absolute Windows paths fail.

Applesoft sources are tokenized with `compileApplesoftBasic` from
`C:\dev\veratest\src\applebasic.mjs`. Its table has 107 entries and covers
Applesoft only — `BRUN` and `CATALOG` are ProDOS BASIC commands and are absent,
so they must go inside string literals with a monitor redirect:

```
10 PRINT CHR$(4);"BRUN VERASD.SYSTEM"
20 PRINT CHR$(4);"CATALOG /VERASD"
```

a2d does not run `/STARTUP`: there is no `BASIC.SYSTEM` on the volume and the
boot block only references `PRODOS`. `LOCAL/DESKTOP.FILE` is a saved desktop
state, not a launch list.

## Pre-existing build bug that had to be fixed

`bin/build_font_from_unicode_txt.pl` cannot build from a CRLF checkout.
`chomp` strips `$/` (`"\n"`) but leaves the CR, so `/^type: (\d+)$/` never
matches and the build dies with `expected type (line 1)`. Fixed by stripping the
CR after each `chomp`. Unrelated to VERA or SD; it just blocks the build.

This also means an early measurement on this branch was wrong: it built against
a stale `out/System.en.font` and reported `SegmentDeskTopAux` padding of `$07B0`
when a clean build actually gives `$02F8`.

## Boot block, disassembled

Block 0 of the a2d volume, loaded at `$0800`. The data at block offsets `$11F`
onward is not code:

```
$0918  58           CLI
$0919  4C 00 20     JMP $2000      <- ProDOS entry, everything funnels here
$091C  4C 47 09     JMP $0947      <- error handler
$091F  02                            <- remaining block count
$0920  26 "PRODOS"                   <- the file to load, hardcoded
$0927  <read next block and advance>  <- JSR'd from the load loop
$0932  7-byte slot tables, also at $0939 and $0940
$0947  <error routine>
$085A  A9 86        LDA #$86         <- self-relocation delta
```

Flow:

```
$0800  ORA ($38,X)          look for language card / boot ROM
$0822  no slot found -> error, else
$0832  copy own bytes $5E-$EA to $0994   (relocates its tail by $86)
$0842  copy the three 7-byte slot tables into $09F2 / $0A7F
$085C  scan slots, compare device names
$08AF  compare $0920 against a directory entry at ($4A),Y   -> finds PRODOS
$08BF  accumulate blocks to load into $091F
$08CA  set $46/$47 = key block, and $4A/$4B, $4D, $61
$08E2  JSR $0927            advance the source
$08EB  loop: STA ($60),Y    copy 512 bytes to the page in zp $60/$61
$090C  DEC $091F -> zero, fall to $0918
```

**The problem: there is no re-entrant "load a file" entry point.** Three
things stand in the way of simply calling it before loading ProDOS:

1. The file name is a hardcoded literal at `$0920`. There is no way to pass a
   different name in.
2. The name comparison at `$08AF` depends on zp `$4A` pointing at an
   **already-open volume directory**, and that pointer is set up much earlier by
   the slot scan and volume-open code.
3. The copy loop at `$08E2-$0916` is not a standalone routine. It sits inline in
   a straight-line find-file / count-blocks / load sequence and assumes all of
   the zero-page state above has already been established.

So loading `VERASD.SYSTEM` first would mean writing a small ProDOS loader in
block 1 — OPEN, READ, walk the directory, find the file, load it. That is
effectively a subset of ProDOS's own startup, and it is a much bigger and
riskier job than the "insert a few instructions before `$0118`" plan this
section originally described. The original estimate was wrong.

If that route is taken, do not hand-patch the binary. Write a `boot.asm`
assembled with `C:\dev\verasdtool\src\asm6502.mjs` so the change is
reproducible, and check the offset arithmetic against the self-relocation at
`$0838` (the block relocates its own tail by `$86`, so absolute addresses
inside the tail are not the on-disk offsets).

Note for anyone writing a disassembler for this: 6502 operands are
little-endian, so `4C 00 20` is `JMP $2000`, not `JMP $0020`. Getting that
backwards makes the whole block look like it references memory outside itself.

## Outstanding

1. **Boot-time installation.** The installer's final `rts` does not fit a2d's
   launch protocol: `src/desktop/main.s` `launch` ends in
   `copy16 #INVOKER, reset_and_invoke_target` / `jmp ResetAndInvoke`, i.e. a2d
   soft-resets and re-invokes whatever it launched. Running the installer from
   `/Startup.Items/` therefore loops forever — verified, the desktop redraws in
   a loop. `/Startup.Items/` is for long-running programs such as
   `BASIC.SYSTEM`.

   The obvious plan was a boot block that loads and runs the installer before
   ProDOS. **Block 0 was disassembled and that plan is much harder than it
   looks.** See "Boot block, disassembled" below for the structure and for why
   there is no re-entrant load entry point to hook.

   An alternative worth investigating first: have the installer *chain* rather
   than return. a2d's `ResetAndInvoke` would soft-reset once, the installer runs,
   and the installer then ProDOS-LOADs and goes `/DESKTOP.SYSTEM`. The loop never
   happens because nothing ever returns to a2d's `launch`. This needs no boot
   block changes at all. Unverified: whether `/Startup.Items/` reaches a2d's own
   launch before the installer gets its turn.

2. **Packaging.** There is no `verasd/images/` base volume and no build script
   on this branch yet. `A2DeskTop-base.hdv` currently exists only on
   `vera-mirror`. Decide whether to vendor an 819 KB binary into this branch,
   parameterise the path, or reference the other worktree.

3. **Confirm `$DD00-$DFFF` is unused in LC bank 2.** a2d's language-card code
   lives in bank 1 and `file_records_buffer` now stops at `$DCFF`, but nothing
   has shown that bank 2 is unused above that. Only running a2d with the driver
   installed will show it.

4. **The gate address is a moving target.** `$AED1` came from measuring main
   segment padding; any change to the main segment can move it, and there is
   currently no build-time assert tying the two together. The 24-byte margin is
   thin. Consider having the build assert that `GATE_ADDR` is above the measured
   main segment end.

5. **End-to-end test.** a2d booted with the driver installed, `VERASD` window
   opened, contents listed, a file copied both ways, a file double-clicked.

## References

- VeraSD-IFS-ProDOS source: `C:\dev\verasdtool\src\verasd-prodos` (read-only)
- Assembler used by the driver build: `C:\dev\verasdtool\src\asm6502.mjs`.
  Note its `),Y` operand comparison is case-sensitive, so a lowercase `),y`
  silently assembles to a same-length absolute indexed store.
- Applesoft tokenizer: `C:\dev\veratest\src\applebasic.mjs`
- cadius: `C:\dev\a2d.bak\tools\cadius.exe`
- VERA display mirroring (separate branch): `vera-mirror/` on branch
  `vera-mirror`, and `C:\dev\AppleWin\VERA.md`