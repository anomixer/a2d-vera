// build.mjs ΓÇö assemble the a2d-specific VeraSD ProDOS block driver.
//
//   node vera/verasd/build.mjs
//
// Produces:
//   verasd_a2d.bin          driver image, load into LC bank 2 at $DD00
//   verasd_gate_a2d.bin     common-LC bridge, load at $FF00
//   verasd_a2d.labels.json  assembler label map for the driver (absolute)
//   verasd_a2d.layout.json  fields the installer must patch, bank-2 offsets
//
// Nothing in C:\dev\verasdtool is written or modified; only its assembler
// module is imported, read-only.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assemble6502 } from "file:///C:/dev/verasdtool/src/asm6502.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Placement, all of it forced by a2d's memory map.
//
// a2d has ~357 bytes of addressable slack in total (LC common 164, LC bank 2
// 32, SegmentDeskTopMain 33, SegmentDeskTopAux 65) and no segment can grow, so a
// 677-byte resident driver had nowhere to go. Freeing it is the job of
// vera/src/desktop/internal.inc + main.s, which shrink FileRecord from 32 to 26
// bytes and cut kFileRecordsBufferLen from $1000 to $0D40. That leaves bank 2
// free from $DD40 up.
//
//   LC bank 1  $D000-$DFFF  SegmentDeskTopLC (code + res.s)
//   LC bank 2  $D000-$DCFF  a2d file_records_buffer
//              $DD00-$DFFF  VeraSD driver        <-- here
//   LC common  $E000-$F2F6  res.s (continues)
//              $F2F7-$FEF6  icon_entries heap
//              $FEF7-$FF9A  gate                 <-- here
//              $FF9B-$FFFF  ProDOS IRQ/BRK handler (untouched)
// The gate lives in main RAM, not in the language card. ProDOS reaches it with
// a plain `JMP ($BF26)`, and main RAM is directly addressable from main, so the
// gate does not need common LC memory. That matters because in DeskTop all of
// LC common `$F195-$FFFF` is the `icon_entries` heap (measured: the label
// `icon_entries:` assembles at $F195), leaving nowhere for a gate. Placing the
// gate in main RAM removes that conflict entirely.
//
// The gate does not live in main RAM. It used to sit at $AED1, in the first free
// byte after a2d's main segment, but that turned out to be wrong: src/desktop/
// README.md says "memory above ~$AE00 is free, and used for file copy buffers and
// overlays". On real hardware a2d loads an overlay over the gate, and the next
// ProDOS dispatch does `JMP ($BF26)` straight into overlay data -- the screen
// corrupts, a2d redraws, and the machine BRKs.
//
// The gate now goes back in LC common at $FF00, upstream's own address, which is
// safe for two reasons. The installer runs before a2d is loaded, so LC common is
// empty at that point. And afterwards the LC segment only covers $D000-$F2FF, so
// loading a2d never writes $FF00; the only thing that grows toward it is the
// `icon_entries` heap, which starts at $F165 and grows 36 bytes per icon, so a
// normal desktop of a handful of volumes stays far below $FF00.
export const DRV_ADDR = 0xdd00
export const DRV_BANK = 2
export const GATE_ADDR = 0xff00
const GATE_TOP = 0x10000 // LC common runs to the top of the language card
const DRV_TOP = 0xe000 // bank 2 must not spill into common memory

const isComment = (l) => {
  const t = l.trim()
  return t.startsWith(";") || t.startsWith("//")
}

// --- guards shared by both sources ------------------------------------------
const check = (lines, label) => {

  // asm6502.mjs compares operand.endsWith("),Y") case-sensitively, so a
  // lowercase "),y" falls through to absolute indexed and assembles
  // "STA $0000,Y" -- same length, no error, writes to a garbage address.
  const lower = lines.filter((l) => !isComment(l) && /\)\s*,\s*y\b/.test(l))
  if (lower.length) {
    throw new Error(`${label}: lowercase indexed-indirect; asm6502 needs ",Y":\n  ${lower.join("\n  ")}`)
  }
}

// Every indexed-indirect must name a pointer we know is zero page.
const ZP_POINTER_NAMES = new Set(["zp_buf", "zp_dsp", "zp_dsc"])
const collectIndirects = (lines, label) => {
  const found = []
  for (const line of lines) {
    if (isComment(line)) continue
    const m = line.match(/^\s*[a-z]{3}\s+\(([^)]+)\)\s*,\s*([A-Za-z])\s*(?:;.*)?$/)
    if (!m) continue
    const [, ptr, idx] = m
    found.push(line.trim())
    if (idx !== "Y") throw new Error(`${label}: index "${idx}" needs exactly "Y": ${line.trim()}`)
    if (!ZP_POINTER_NAMES.has(ptr.trim())) {
      throw new Error(`${label}: unknown indirect pointer "${ptr.trim()}": ${line.trim()}`)
    }
  }
  return found
}

// --- gate --------------------------------------------------------------------
// The gate is assembled first: the driver calls GATE_LOAD/GATE_STORE, and those
// equates are the gate's load_buffer/store_buffer entry addresses.
const gateSrc = fs.readFileSync(path.join(__dirname, "verasd_gate_a2d.asm"), "utf-8")
// The upstream gate hardcodes `jsr $D400` as its driver entry. Relocate that
// operand to wherever this build actually loads the driver. Nothing else in the
// gate may be edited: load_buffer/store_buffer are the LC bank 1<->bank 2 buffer
// bridge and ProDOS's block buffer does live in language-card space.
const gateSrcRelocated = gateSrc.replace(/jsr\s+\$D400/, `jsr $${DRV_ADDR.toString(16).toUpperCase()}`)
if (gateSrcRelocated === gateSrc) {
  throw new Error("gate source has no `jsr $D400` driver entry to relocate")
}
const gateLines = gateSrcRelocated.split(/\r?\n/)
check(gateLines, "gate")
const gateLabels = {}
const gateBytes = assemble6502(gateLines, GATE_ADDR, gateLabels)

for (const [name, label] of [["GATE_LOAD", "load_buffer"], ["GATE_STORE", "store_buffer"]]) {
  if (gateLabels[label] === undefined) {
    throw new Error(`gate is missing the ${label} routine the driver's ${name} needs`)
  }
}

// --- driver ------------------------------------------------------------------
const gateEquates =
  `GATE_LOAD = $${Number(gateLabels.load_buffer).toString(16)}\n` +
  `GATE_STORE = $${Number(gateLabels.store_buffer).toString(16)}\n`
const drvLines = (gateEquates + fs.readFileSync(path.join(__dirname, "verasd_a2d.asm"), "utf-8")).split(/\r?\n/)
check(drvLines, "driver")
const drvIndirects = collectIndirects(drvLines, "driver")
if (drvIndirects.length === 0) throw new Error("driver: no indexed-indirect accesses found; the check is not running")

const drvLabels = {}
const drvBytes = assemble6502(drvLines, DRV_ADDR, drvLabels)

if (drvBytes.length === 0) throw new Error("driver assembled to zero bytes")
if (DRV_ADDR + drvBytes.length > DRV_TOP) {
  throw new Error(
    `driver overruns bank 2: ends $${(DRV_ADDR + drvBytes.length - 1).toString(16)}, limit $${(DRV_TOP - 1).toString(16)}`,
  )
}
if (drvLabels.start !== DRV_ADDR) {
  throw new Error(`driver entry is $${Number(drvLabels.start).toString(16)}, expected $${DRV_ADDR.toString(16)}`)
}
// php / sei / cld / ldx #$17
for (const [i, want] of [0x08, 0x78, 0xd8, 0xa2, 0x17].entries()) {
  if (drvBytes[i] !== want) {
    throw new Error(`driver entry byte ${i} is $${drvBytes[i].toString(16)}, expected $${want.toString(16)}`)
  }
}

if (gateBytes.length === 0) throw new Error("gate assembled to zero bytes")
if (GATE_ADDR + gateBytes.length > GATE_TOP) {
  throw new Error(
    `gate overruns the ProDOS handler: ends $${(GATE_ADDR + gateBytes.length - 1).toString(16)}, limit $${(GATE_TOP - 1).toString(16)}`,
  )
}
// The installer'"'"'s rollback path needs this label (GATE_NO_DEVICE).
if (gateLabels.no_device === undefined) {
  throw new Error("gate is missing the no_device label the installer rollback uses")
}
if (gateLabels.start !== GATE_ADDR) {
  throw new Error(`gate entry is $${Number(gateLabels.start).toString(16)}, expected $${GATE_ADDR.toString(16)}`)
}
// The gate must JSR the driver's real entry point. Verify it in the assembled
// bytes rather than trusting the source edit: a stale operand means the gate
// jumps into the middle of the driver and executes data.
{
  const lo = DRV_ADDR & 0xff
  const hi = (DRV_ADDR >> 8) & 0xff
  const hasEntry = gateBytes.some((b, i) => b === 0x20 && gateBytes[i + 1] === lo && gateBytes[i + 2] === hi)
  if (!hasEntry) {
    throw new Error(
      `gate has no JSR $${DRV_ADDR.toString(16).toUpperCase()}; it cannot reach the driver at $${DRV_ADDR.toString(16).toUpperCase()}`,
    )
  }
}

// Every GATE_* equate the driver uses must resolve to a real gate routine; the
// gate stage above throws if load_buffer/store_buffer are missing, and it fails
// loudly if the driver's `jsr GATE_*` no longer has a matching definition.

// --- patch fields ------------------------------------------------------------
// All offsets are relative to the driver's load address, so the installer can
// add DRV_ADDR after copying the image into LC bank 2.
const PATCH_FIELDS = {
  blocks_lo: 1,
  blocks_hi: 1,
  part_offset: 2,
  spi_data_addr: 2,
  spi_ctrl_addr: 2,
  byte_addressed: 1,
  unit_number: 1,
}
const layout = {
  driver: { addr: DRV_ADDR, bank: DRV_BANK, size: drvBytes.length },
  gate: { addr: GATE_ADDR, bank: "common", size: gateBytes.length },
  patch: {},
}
for (const [name, width] of Object.entries(PATCH_FIELDS)) {
  if (drvLabels[name] === undefined) throw new Error(`driver is missing patch field ${name}`)
  const offset = drvLabels[name] - DRV_ADDR
  if (offset < 0 || offset + width > drvBytes.length) throw new Error(`patch field ${name} outside the image`)
  layout.patch[name] = { offset, width, addr: drvLabels[name] }
}

fs.writeFileSync(path.join(__dirname, "verasd_a2d.bin"), drvBytes)
fs.writeFileSync(path.join(__dirname, "verasd_gate_a2d.bin"), gateBytes)
fs.writeFileSync(path.join(__dirname, "verasd_a2d.labels.json"), JSON.stringify(drvLabels, null, 2))
fs.writeFileSync(path.join(__dirname, "verasd_gate_a2d.labels.json"), JSON.stringify(gateLabels, null, 2))
fs.writeFileSync(path.join(__dirname, "verasd_a2d.layout.json"), JSON.stringify(layout, null, 2))

const hx = (n) => `$${n.toString(16).toUpperCase()}`
console.log(`driver  ${drvBytes.length} bytes  LC bank ${DRV_BANK}  ${hx(DRV_ADDR)}-${hx(DRV_ADDR + drvBytes.length - 1)}`)
console.log(`gate    ${gateBytes.length} bytes  main RAM  ${hx(GATE_ADDR)}-${hx(GATE_ADDR + gateBytes.length - 1)}`)
console.log(`  bank 2 free space was ${hx(DRV_ADDR)}-${hx(DRV_TOP - 1)} (${DRV_TOP - DRV_ADDR} bytes), ${DRV_TOP - DRV_ADDR - drvBytes.length} spare`)
console.log(`  gate headroom before the ProDOS handler: ${GATE_TOP - GATE_ADDR - gateBytes.length} bytes`)
console.log(`  indexed-indirect accesses checked: ${drvIndirects.length}`)
console.log("  patch fields (offset from $DD40):")
for (const [name, p] of Object.entries(layout.patch)) {
  console.log(`    ${name.padEnd(16)} +${String(p.offset).padStart(3)}  width ${p.width}  ($${drvLabels[name].toString(16)})`)
}
