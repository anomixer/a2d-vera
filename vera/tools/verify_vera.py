#!/usr/bin/env python3
"""Pixel-exact verification of the a2d VERA DHGR->1bpp blitter.

Given an AppleWin save-state YAML (from `-save-state`) that contains Main
memory, Auxiliary memory and the VERA unit's 128KB Video RAM + Registers, this
script:

  1. Rebuilds the expected 1bpp VERA bitmap from the DeskTop DHGR framebuffer
     (main + aux $2000-$3FFF), using the same algorithm as
     src/desktop/vera_drv.s (hires_table scanlines, byte-by-byte AUX/MAIN
     interleave, 8 source 7-bit bytes -> 7 VERA bytes, MSB=leftmost).
  2. Compares it against the VERA bitmap region in the dumped VRAM
     (rows 0..191 * 80 bytes).
  3. Reports matching/mismatching rows.

Usage:
  python verify_vera.py <save-state.sav> [vram.bin] [-v]

  - If vram.bin is given (from `-vera-dump`), it is used directly for the
    comparison instead of the Video RAM embedded in the save state.
  - Rows that differ are listed; use `-v` for a full per-row report.
"""
import sys, re, hashlib

def parse_mem_section(lines, start):
    """Collect `ADDR: HEX` lines (relative address -> bytes) from `start` until
    the indentation drops below the section's key. Returns (dict, next_idx)."""
    # Find indentation of first data line
    i = start
    blocks = {}
    first_indent = None
    while i < len(lines):
        m = re.match(r'^(\s*)([0-9A-Fa-f]+):\s+([0-9A-Fa-f]+)\s*$', lines[i])
        if not m:
            break
        indent = len(m.group(1))
        if first_indent is None:
            first_indent = indent
        elif indent < first_indent:
            break
        addr = int(m.group(2), 16)
        data = bytes.fromhex(m.group(3))
        blocks[addr] = data
        i += 1
    return blocks, i

def section_lines(lines, name):
    """Return (start_index_of_children, indent_of_key) for the section `name`,
    or (None,None). Finds the key line whose stripped text == name and returns
    the index after it."""
    for i, l in enumerate(lines):
        if l.strip() == name:
            return i + 1
    return None

def read_region(lines, section_name):
    """Read a whole memory region (list of `ADDR: HEX` blocks) named by
    section_name; return a contiguous bytearray covering [0, max_end)."""
    idx = section_lines(lines, section_name)
    if idx is None:
        return None
    blocks, _ = parse_mem_section(lines, idx)
    if not blocks:
        return None
    max_end = max(a + len(d) for a, d in blocks.items())
    mem = bytearray(max_end)
    for a, d in blocks.items():
        mem[a:a+len(d)] = d
    return mem

# --- DHGR hires table (mirror of mgtk hires_table_lo/hi) --------------------
# 192 entries. lo/hi as in src/desktop/vera_drv.s dhr_row_lo/dhr_row_hi.
# lo: [0 x8, 0x80 x8] x4, then [0x28 x8, 0xA8 x8] x4, then [0x50 x8, 0xD0 x8] x4
DHR_LO = []
for lo_lo, lo_hi in ((0x00,0x80),(0x28,0xA8),(0x50,0xD0)):
    for _ in range(4):
        DHR_LO += [lo_lo]*8 + [lo_hi]*8
# hi: [0,4,8,C,10,14,18,1C] x2, [1,5,9,D,11,15,19,1D] x2, ... x3
DHR_HI = []
for _ in range(3):
    for a in (0x00,0x01,0x02,0x03):
        DHR_HI += [a, a+4, a+8, a+0xC, a+0x10, a+0x14, a+0x18, a+0x1C]*2

def rev7(b):
    """Reverse the low 7 bits of b (bit6<->bit0); bit7 ignored."""
    r = 0
    for i in range(7):
        if b & (1 << i):
            r |= (1 << (6 - i))
    return r & 0x7F

def dhr_row_to_vera(main, aux, y):
    """Return the 70 VERA 1bpp bytes for DHGR scanline y (560 px -> 70 bytes).
    Display order: byte-by-byte AUX/MAIN interleave; 8 source 7-bit bytes pack
    into 7 VERA bytes, MSB = leftmost."""
    hi = DHR_HI[y]; lo = DHR_LO[y]
    base = 0x2000 + (hi << 8) + lo
    inter = bytearray(80)
    for i in range(40):
        inter[2*i]   = aux[base + i] & 0x7F
        inter[2*i+1] = main[base + i] & 0x7F
    out = bytearray(70)
    # 80 source bytes -> 10 groups of 8 -> 7 output bytes each (70 total)
    for g in range(10):
        for k in range(7):
            a = rev7(inter[8*g + k])
            b = rev7(inter[8*g + k + 1])
            # PACK_DHR_BYTE k, k+1, k+1, 6-k
            out[7*g + k] = ((a << (k+1)) | (b >> (6-k))) & 0xFF
    return out

def main():
    args = [a for a in sys.argv[1:]]
    verbose = '-v' in args
    args = [a for a in args if a != '-v']
    sav = args[0]
    vram_file = args[1] if len(args) > 1 else None
    lines = open(sav, encoding='utf-8', errors='replace').read().splitlines()
    main = read_region(lines, 'Main Memory:')
    aux = read_region(lines, 'Auxiliary Memory Bank00:')
    if vram_file:
        vram = open(vram_file, 'rb').read()
    else:
        vram = read_region(lines, 'Video RAM:')
    if main is None or aux is None or vram is None:
        print('Missing sections', 'main' if main is None else '', 'aux' if aux is None else '', 'vram' if vram is None else '')
        sys.exit(2)
    print('main=%d aux=%d vram=%d' % (len(main), len(aux), len(vram)))
    # VERA bitmap region: rows 0..191 * 80 bytes = 15360 bytes. The DeskTop
    # DHGR frame is 560px = 70 bytes/row, placed in the first 70 bytes of each
    # 80-byte VERA row (TILEW=1 => 640px). Compare only the 70-byte content;
    # the last 10 bytes/row are unused padding.
    expected = bytearray(192 * 70)
    for y in range(192):
        expected[y*70:(y+1)*70] = dhr_row_to_vera(main, aux, y)
    got = vram[:192*80]
    # Compare
    mismatched = []
    for y in range(192):
        if expected[y*70:(y+1)*70] != got[y*80:y*80+70]:
            mismatched.append(y)
    if not mismatched:
        print('PASS: all 192 DHGR rows match the VERA bitmap exactly.')
        return
    print('FAIL: %d/192 rows differ.' % len(mismatched))
    if verbose or len(mismatched) <= 20:
        for y in mismatched:
            print(' row %3d' % y)
    else:
        print(' first mismatched rows:', mismatched[:20], '...')

if __name__ == '__main__':
    main()
