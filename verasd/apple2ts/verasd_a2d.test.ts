// Verifies that the a2d-launched VeraSD installer actually registers the SD card
// with ProDOS.
//
// The existing verasd_install.test.ts covers the installer itself, but it boots
// a volume with DESKTOP.SYSTEM renamed so ProDOS drops to the `]` monitor. This
// one boots the real a2d image, which runs the installer from
// src/desktop/init.s FinalSetup via MLI $D7, and then reads ProDOS's own device
// list back out of memory. That is the only observation that distinguishes
// "installed" from "loaded but not registered", because a2d draws its volume
// icons before FinalSetup runs, so a screenshot taken at the desktop prompt
// shows the same thing either way.
//
// What to look at after boot:
//   $BF31       DEVCNT, number of devices ProDOS knows about
//   $BF32..     DEVLST, one entry per device
//   $BF26/$BF27 the /RAM slot the installer repurposes
//   $DD00 (LC2) driver entry 08 78 d8 a2 2b once the installer has copied it
//   $AED1       gate in main RAM, also 08 78 ...

import * as fs from "fs"
import { doSetEmuDriveNewData } from "../drivestate"
import { setIsTesting } from "../../worker2main"
import { doBoot, doSetRunMode } from "../../motherboard"
import { s6502 } from "../../instructions"
import { processInstruction } from "../../cpu6502"
import { RUN_MODE } from "../../../common/utility"
import { enableVera, resetVera, initVera, sdcard_attach_image } from "./vera"
import { memGet, memSet } from "../../memory"
import { enableMouseCard } from "../mouse"

const HDV = process.env.VERASD_A2D_HDV ||
  "C:/Users/USER/AppData/Local/Temp/opencode/vtest/A2D-verasd.hdv"
const SD_IMG = process.env.VERA_SD_IMG ||
  "C:/dev/verasdtool/VeraSD-IFS-ProDOS.img"

const BANK2 = 0xc083
const DRV_AT = 0xdd00
const GATE_AT = 0xaed1
const DRV_ENTRY = [0x08, 0x78, 0xd8, 0xa2, 0x2b]

const DEVCNT = 0xbf31
const DEVLST = 0xbf32
const RAM_SLOT = 0xbf26

const readMain = (addr: number, len: number) => {
  const out: number[] = []
  for (let i = 0; i < len; i++) out.push(memGet((addr + i) & 0xffff, false))
  return out
}

const readLcBank2 = (addr: number, len: number) => {
  memSet(BANK2, 0)
  return readMain(addr, len)
}

const hex = (a: number[]) => a.map((b) => b.toString(16).padStart(2, "0")).join(" ")

describe("VeraSD installed from a2d init", () => {
  test("registers the SD volume with ProDOS", () => {
    setIsTesting()
    initVera()
    resetVera()
    enableVera(true, 2)
    enableMouseCard(true, 5)
    sdcard_attach_image(new Uint8Array(fs.readFileSync(SD_IMG)), "VeraSD-IFS-ProDOS.img")

    const data = fs.readFileSync(HDV)
    doSetEmuDriveNewData({
      index: 0,
      hardDrive: true,
      drive: 1,
      filename: "A2D-verasd.hdv",
      status: "",
      motorRunning: false,
      diskHasChanges: false,
      isWriteProtected: false,
      diskData: new Uint8Array(data),
      lastAppleWriteTime: 0,
      cloudData: null,
      writableFileHandle: null,
      lastLocalFileTime: 0,
      lastLocalFileWriteTime: 0,
    })
    doBoot()
    doSetRunMode(RUN_MODE.RUNNING)

    let crash: null | { pc: number; op: number } = null
    let steps = 0
    const limit = 40_000_000

    while (steps < limit) {
      const pc = s6502.PC
      const op = memGet(pc, false)
      if (op === 0x00 && pc < 0xc000) {
        crash = { pc, op }
        break
      }
      try {
        processInstruction()
      } catch (e) {
        console.log(`threw at $${pc.toString(16)} after ${steps} steps:`, e)
        break
      }
      steps++
    }

    const devcnt = readMain(DEVCNT, 1)[0]
    const devlst = readMain(DEVLST, 16)
    const ramSlot = readMain(RAM_SLOT, 2)
    const drv = readLcBank2(DRV_AT, 5)
    const gate = readMain(GATE_AT, 4)

    console.log(`steps:            ${steps}`)
    console.log(`crash:            ${crash ? `$${crash.pc.toString(16)} op=$${crash.op.toString(16)}` : "none"}`)
    console.log(`DEVCNT ($BF31):   ${devcnt}`)
    console.log(`DEVLST ($BF32):   ${hex(devlst)}`)
    console.log(`/RAM ($BF26/27):  ${hex(ramSlot)}`)
    console.log(`driver @ $DD00:   ${hex(drv)}  ${hex(DRV_ENTRY) === hex(drv) ? "== entry OK" : "!= entry"}`)
    console.log(`gate   @ $AED1:   ${hex(gate)}`)

    expect(crash).toBeNull()
    // The installer copies the driver into LC bank 2 before it registers.
    expect(hex(drv)).toBe(hex(DRV_ENTRY))
  }, 600_000)
})