# VeraSD block driver for a2d

Builds the [VeraSD-IFS-ProDOS](https://github.com/) block driver relocated for use
alongside DeskTop 1.6, plus the installer that registers it with ProDOS.

```
driver  681 bytes  LC bank 2  $DD00
gate     80 bytes  main RAM   $AED1
installer 2392 bytes, load $2000
```

## Build

```powershell
node verasd/build.mjs
node verasd/build-installer.mjs
```

Output lands next to this file. Nothing in `C:\dev\verasdtool` is written; its
`src/asm6502.mjs` is imported read-only.

## What this build changes

Almost nothing. `verasd_a2d.asm` and `verasd_gate_a2d.asm` are upstream's
`verasd_drv.asm` and `verasd_gate.asm` **verbatim**; `build.mjs` only rewrites
the gate's `jsr $D400` operand to the real driver address.
`verasd_a2d_install.asm` is upstream `verasd.asm` with two constants changed:

```
DRV_BODY    $D400 -> $DD00    where the driver is copied
DRV_TARGET  $FF00 -> $AED1    where the gate is copied
```

The gate is in main RAM rather than language-card common memory because a2d uses
all of LC common for its `icon_entries` heap. The gate only has to be reachable
by ProDOS's `JMP ($BF26)`, and main RAM qualifies. See `AGENTS.md`.

| file | contents |
| :--- | :--- |
| `verasd_a2d.asm` | driver source, upstream verbatim |
| `verasd_gate_a2d.asm` | gate source, upstream verbatim |
| `verasd_a2d_install.asm` | installer source, upstream with two constants changed |
| `build.mjs` | assembler wrapper plus the guards below |
| `build-installer.mjs` | embeds driver and gate into the installer |
| `*.bin` | built images |
| `*.labels.json` | label maps, absolute addresses |

## Guards

`build.mjs` fails the build rather than producing something subtly wrong:

- The **assembled gate bytes** must contain `JSR <DRV_ADDR>`. Checking the
  source is not sufficient: the gate's driver address once drifted from the
  installer's copy destination, and the only symptom was `VERASD FAILED`.
- `load_buffer` and `store_buffer` must be present. They are the LC bank 1 <->
  bank 2 bridge for ProDOS's block buffer. Removing them hangs the machine on
  the first buffer read. The gate is therefore assembled first, so the driver's
  `GATE_LOAD` / `GATE_STORE` equates can be resolved from its labels.
- Indexed-indirect operands must use `,Y`. `asm6502.mjs` compares case
  sensitively, so `),y` silently assembles to a same-length absolute indexed
  store to a garbage address.

## Verifying it standalone

The driver does not need a2d. On any bootable ProDOS volume, add
`verasd_a2d_install.bin` as `VERASD.SYSTEM` and a tokenized `STARTUP`, then boot:

```
10 PRINT CHR$(4);"BRUN VERASD.SYSTEM"
20 PRINT CHR$(4);"CATALOG /VERASD"
```

`BRUN` and `CATALOG` are ProDOS BASIC commands, so they go inside string literals
behind a monitor redirect. Success looks like:

```
VERASD INSTALLED
/VERASD
  VERASD.SYSTEM  BIN  6  2392 A=$2000
  BLOCKS FREE: 65507  BLOCKS USED: 28
  TOTAL BLOCKS: 65535
```

See `AGENTS.md` for what still has to happen before this is usable from
DeskTop itself.