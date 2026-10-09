# VeraSD boot disk image

This directory contains the bootable Apple II DeskTop 1.5 800K 2mg image with
the VeraSD ProDOS IFS installer added:
`A2-Desktop-1.5-en_800k-VeraSD.2mg`.

The disk image is an integration artifact. Keep the DeskTop program files
unchanged; VeraSD is added as a ProDOS `SYS` file in the boot volume root. The
boot directory order is intentional:

1. `CLOCK.SYSTEM`
2. `VERASD.SYSTEM`
3. `DESKTOP.SYSTEM`

ProDOS runs the root `.SYSTEM` files in directory order. The VeraSD installer
attempts to install the driver and hands off to the next `.SYSTEM` on both
success and failure. Keep it after Clock (which has already been verified to
run) and before DeskTop.

## Rebuild/update

Build the current installer in `C:\dev\verasdtool`:

```powershell
node src\verasd-prodos\verasd.mjs
```

This writes `src\verasd-prodos\verasd_sys.bin` and updates the standalone
ProDOS disk image. Copy the SYS binary into this directory with ProDOS metadata
encoded in the filename, then replace the volume-root entry with Cadius:

```powershell
Copy-Item C:\dev\verasdtool\src\verasd-prodos\verasd_sys.bin `
  C:\dev\a2d-verasd\verasd\VERASD.SYSTEM#FF2000
cadius.exe REPLACEFILE `
  C:\dev\a2d-verasd\verasd\A2-Desktop-1.5-en_800k-VeraSD.2mg `
  /A2.DeskTop C:\dev\a2d-verasd\verasd\VERASD.SYSTEM#FF2000
```

When preparing a fresh image, copy `A2DeskTop-1.5-en_800k.2mg` first, then add
the SYS entry and arrange the root directory entries in the order above. Do not
sort the boot directory alphabetically. Verify the image with
`cadius.exe CHECKVOLUME` and inspect the physical root directory order; Cadius
CATALOG output is alphabetized and does not prove boot order.

Do not change a2d source code to install the driver. Stock a2d and the stock
VeraSD IFS coexist; this image only automates installation during ProDOS boot.
