# VeraSD block driver for a2d

An a2d-specific build of the VERA SD ProDOS 8 block driver.

```
node vera/verasd/build.mjs
```

Output lands next to this file. Nothing in `C:\dev\verasdtool` is written; its
`src/asm6502.mjs` is imported read-only.

| file | contents |
| :--- | :--- |
| `verasd_a2d.asm` | driver source |
| `build.mjs` | assembler wrapper plus the guards described below |
| `verasd_a2d.bin` | 677-byte image, load at `$0800` |
| `verasd_a2d.labels.json` | assembler label map, absolute addresses |
| `verasd_a2d.layout.json` | the fields a2d must patch, as `$0800`-relative offsets |

## What this build changes, and why

Upstream (`C:\dev\verasdtool\src\verasd-prodos`) keeps the driver in language
card bank 2 at `$D400` and bridges to the caller's buffer through a common-memory
gate at `$FF00`. That is fine for a plain ProDOS session and does not fit inside
DeskTop.

**1. Home is `$0800`, in ordinary RAM.** Measured with apple2ts against
`A2DeskTop-VERA.hdv`:

- Language card has about 205 bytes free across three places, against the 677
  this driver needs. Bank 2 is a2d's `file_records_buffer`, whose own assert
  (`main.s:2270`) demands more than `32 * kMaxIconCount` = 4064 of its 4096.
- Every lower main-RAM hole is written. `$0400-$07FF` loses 442 bytes on a single
  window open; `$1000-$1BFF` is rewritten completely, because 80STORE banks
  `$0400-$1FFF` into aux.
- `$0800-$0FFF` is the only window that fits, and it is transient: it is
  `SegmentInitializer` plus the whole Desk Accessory area.

**2. No `$FF00` gate.** The gate existed only to reach ProDOS buffers held in
LC bank 1 while the driver ran from LC bank 2. In ordinary RAM the caller's
buffer is in whichever bank RAMWRT/RAMRD already select, so `lda (zp_buf),Y` and
`sta (zp_buf),Y` are correct as written: the driver inherits the bank state
ProDOS and a2d left behind. Removing the gate also drops the dependency on the
ProDOS `$FF9B` interrupt code, removes the `/RAM` device-list juggling, and saves
1024 redundant `$C08B`/`$C083` softswitch accesses per 512-byte block.

**3. No language-card banking at all**, so there is no LCBANK1/LCBANK2
save-restore to get wrong.

Net size change: 681 to 677 bytes.

## Why the image goes into both the main and the aux copy

80STORE banks `$0400-$1FFF`, so `$0800` is not one location but two. a2d writes
the same 677 bytes to the main and the aux copy, 1,354 bytes total. Instruction
fetches then work no matter which bank RAMRD selects, and the driver still
reaches ProDOS's buffer in whichever bank RAMWRT left it. That is why there is no
RAMRD/RAMWRT juggling in the driver.

## Residency

`$0800` is `SegmentInitializer` and Desk Accessory territory, so the image is not
kept resident. a2d reloads it from its own volume before each SD operation. The
ProDOS device list entry points at the fixed `$0800`, so reloading code never
disturbs the device list.

The SD card is a raw ProDOS volume, so ProDOS itself does all the filesystem
work: directory traversal, cluster chains, the allocation bitmap. Nothing in this
directory reimplements any of it.

## Patch fields

`verasd_a2d.layout.json` lists what a2d must write before ProDOS is allowed to
call the driver. All offsets are relative to `$0800`.

| field | offset | width | meaning |
| :--- | ---: | ---: | :--- |
| `blocks_lo` | 659 | 1 | low byte of the volume's block count |
| `blocks_hi` | 660 | 1 | high byte |
| `part_offset` | 661 | 2 | sector offset to an MBR partition, 0 for a superfloppy |
| `spi_data_addr` | 663 | 2 | `$C21E` for slot 2 |
| `spi_ctrl_addr` | 665 | 2 | `$C21F` for slot 2 |
| `byte_addressed` | 667 | 1 | 0 for SDHC, 1 for SDSC |
| `unit_number` | 668 | 1 | ProDOS device unit, `$20` upstream |

## Build guards

`build.mjs` refuses to produce an image rather than ship a silent bug.

- **No `GATE_LOAD`/`GATE_STORE` references.** Those are equates the upstream
  build injects pointing into the `$FF00` bridge. Reintroducing one would
  assemble cleanly and then need the gate at run time.
- **Indexed-indirect operands are checked.** `asm6502.mjs` compares
  `operand.endsWith("),Y")` case-sensitively, so a lowercase `),y` falls through
  to the absolute-indexed branch and assembles `STA $0000,Y` ΓÇö *same length, no
  error, writes to a garbage address*. This is silent and size-preserving; both
  an exact-case check and a source-level `,Y` check guard it. Confirmed by
  mutation: injecting a lowercase `y` leaves the image at 677 bytes either way.
- **Entry bytes are checked** against `php / sei / cld / ldx #$17`, so a stray
  `HEX` line or a label move cannot pass unnoticed.
- **Size and window**: the image must fit under `$1000`.
