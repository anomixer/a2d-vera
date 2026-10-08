// build-installer.mjs ΓÇö assemble the a2d VeraSD installer with the a2d driver
// and gate embedded, exactly the way verasdtool's verasd.mjs does it.
//
//   node vera/verasd/build-installer.mjs
//
// The installer is a standalone ProDOS program (load $2000). It is NOT resident
// and contains no a2d-specific code: it detects VERA, initialises the SD card,
// copies the driver into LC bank 2 at $DD00, patches its data area, installs a
// gate in main RAM, and registers the device in ProDOS's device list in
// place of the native /RAM device.
//
// Output:
//   verasd_a2d_install.bin     the installer program image, load $2000

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assemble6502 } from "file:///C:/dev/verasdtool/src/asm6502.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INST_ADDR = 0x2000

const drv = fs.readFileSync(path.join(__dirname, "verasd_a2d.bin"))
const gate = fs.readFileSync(path.join(__dirname, "verasd_gate_a2d.bin"))
const drvLabels = JSON.parse(fs.readFileSync(path.join(__dirname, "verasd_a2d.labels.json"), "utf8"))
const gateLabels = JSON.parse(fs.readFileSync(path.join(__dirname, "verasd_gate_a2d.labels.json"), "utf8"))

// Both label maps come from absolute addresses, which is what the installer
// wants: it patches the driver in place at its load address rather than
// relocating anything.
const equates = [
  `GATE_SIZE = ${gate.length}`,
  `GATE_NO_DEVICE = ${gateLabels.no_device}`,
  `DRV_BLOCKS_LO = ${drvLabels.blocks_lo}`,
  `DRV_BLOCKS_HI = ${drvLabels.blocks_hi}`,
  `DRV_PART_OFF = ${drvLabels.part_offset}`,
  `DRV_SPI_DATA = ${drvLabels.spi_data_addr}`,
  `DRV_SPI_CTRL = ${drvLabels.spi_ctrl_addr}`,
  `DRV_BYTE_MODE = ${drvLabels.byte_addressed}`,
  `DRV_UNIT = ${drvLabels.unit_number}`,
  `DRV_SIZE = ${drv.length}`,
  `DRV_PAGES = ${Math.ceil(drv.length / 256)}`,
]

// DRV_PAGES pages are copied, so the driver must not start so late that a whole
// page overshoots $DFFF into common memory.
const drvStart = 0xdd00
const copied = Math.ceil(drv.length / 256) * 256
if (drvStart + copied > 0xe000) {
  throw new Error(
    `driver copy of ${copied} bytes from $${drvStart.toString(16)} reaches $${(drvStart + copied - 1).toString(16)}, past the bank 2 limit $DFFF`,
  )
}

const hexLines = []
for (let i = 0; i < drv.length; i += 16) {
  hexLines.push(
    "HEX " +
      Array.from(drv.slice(i, i + 16))
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" "),
  )
}

const instLines = fs.readFileSync(path.join(__dirname, "verasd_a2d_install.asm"), "utf-8").split(/\r?\n/)
// Order matters and mirrors verasdtool's verasd.mjs: the source ends with the
// `driver_src:` label, the driver image follows it as HEX rows, then `gate_src:`
// and the gate bytes. Dropping `...hexLines` here assembles cleanly and produces
// an installer that copies the gate into the driver's place -- see the guards
// below.
const full = [...equates, ...instLines, ...hexLines, "gate_src:", ...Array.from(gate, (b) => "!byte " + b)]
const labels = {}
const bytes = assemble6502(full, INST_ADDR, labels)

// Guard: the embedded driver must actually be present between driver_src: and
// gate_src:. If the HEX lines are dropped the installer still assembles and runs,
// but copy_driver reads whatever follows driver_src: and installs garbage -- which
// shows up as nonsense on screen rather than an obvious build failure.
if (labels.driver_src === undefined || labels.gate_src === undefined) {
  throw new Error("driver_src/gate_src labels missing from the assembled installer")
}
if (labels.gate_src - labels.driver_src !== drv.length) {
  throw new Error(
    `driver bytes missing from the installer: driver_src=$${labels.driver_src.toString(16)} ` +
      `gate_src=$${labels.gate_src.toString(16)}, expected a gap of ${drv.length}`,
  )
}
if (labels.gate_src + gate.length !== INST_ADDR + bytes.length) {
  throw new Error(
    `gate bytes missing from the installer: gate ends at $${(labels.gate_src + gate.length).toString(16)}, ` +
      `image ends at $${(INST_ADDR + bytes.length).toString(16)}`,
  )
}

if (bytes.length === 0) throw new Error("installer assembled to zero bytes")

fs.writeFileSync(path.join(__dirname, "verasd_a2d_install.bin"), bytes)
fs.writeFileSync(path.join(__dirname, "verasd_a2d_install.labels.json"), JSON.stringify(labels, null, 2))

console.log(`installer ${bytes.length} bytes, load $${INST_ADDR.toString(16)}`)
console.log(`  embedded driver ${drv.length} bytes -> LC bank 2 $${drvStart.toString(16)} (${copied} bytes copied)`)
console.log(`  embedded gate   ${gate.length} bytes -> main RAM $${gateLabels.start.toString(16).toUpperCase()}`)
console.log(`  driver patch points: blocks $${drvLabels.blocks_lo.toString(16)}, spi $${drvLabels.spi_data_addr.toString(16)}`)
console.log("  install via BRUN from BASIC, or by double-clicking in a2d")
