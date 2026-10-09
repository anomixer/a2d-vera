# Apple II DeskTop 1.5 with VeraSD

`A2-Desktop-1.5-en_800k-VeraSD.2mg` is an 800K ProDOS boot disk based on
`A2DeskTop-1.5-en_800k.2mg`. It adds the current VeraSD ProDOS IFS installer as
`VERASD.SYSTEM` in the boot volume root. No a2d program files are modified.

At boot, ProDOS runs the system files in this directory order:

1. `CLOCK.SYSTEM`
2. `VERASD.SYSTEM`
3. `DESKTOP.SYSTEM`

The VeraSD installer attempts to install the driver, then chains to the next
root `.SYSTEM` whether installation succeeds or fails. The intended handoff is
therefore to `DESKTOP.SYSTEM` in either case.

## Test media

`VeraSD-IFS-ProDOS.img.zip` contains the 32 MiB ProDOS SD-card image used for
VeraSD testing. Extract it once:

```powershell
Expand-Archive .\VeraSD-IFS-ProDOS.img.zip -DestinationPath .
```

In AppleWin, configure the VERA card to use `VeraSD-IFS-ProDOS.img`, then boot
`A2-Desktop-1.5-en_800k-VeraSD.2mg` from the floppy drive. On real hardware,
write the extracted `.img` to the SD card used by the VERA card. The installer
probes the card during boot; DeskTop starts after it.

## Rebuild the installer

Clone VeraSDTool under `C:\dev`, then build the installer:

```powershell
cd C:\dev
git clone https://github.com/anomixer/verasdtool.git
cd verasdtool
node src\verasd-prodos\verasd.mjs
```

The builder emits `src\verasd-prodos\verasd_sys.bin`. To update this disk image
from the `a2d-verasd` checkout, copy that output and use Cadius (the `#FF2000` suffix sets ProDOS
file type `SYS` and load address `$2000`):

```powershell
Copy-Item C:\dev\verasdtool\src\verasd-prodos\verasd_sys.bin `
  C:\dev\a2d-verasd\verasd\VERASD.SYSTEM#FF2000
cadius.exe REPLACEFILE `
  C:\dev\a2d-verasd\verasd\A2-Desktop-1.5-en_800k-VeraSD.2mg `
  /A2.DeskTop C:\dev\a2d-verasd\verasd\VERASD.SYSTEM#FF2000
cadius.exe CHECKVOLUME `
  C:\dev\a2d-verasd\verasd\A2-Desktop-1.5-en_800k-VeraSD.2mg
```

Replacing the existing entry preserves its root-directory position. For a
fresh image, start from `A2DeskTop-1.5-en_800k.2mg` and arrange the three boot
files in the order shown above. Check the physical root directory entry order:
Cadius `CATALOG` output is sorted for display and does not show boot order.

See [AGENTS.md](AGENTS.md) for repository-specific maintenance notes.
