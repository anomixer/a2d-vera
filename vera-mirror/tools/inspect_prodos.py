from pathlib import Path
import sys

def inject_desktop(src_path: Path, dst_path: Path, payload_path: Path):
    if not src_path.exists():
        print(f"Skipping {src_path} (does not exist)")
        return
    img = bytearray(src_path.read_bytes())
    def block(n): return img[n*512:(n+1)*512]
    def entries(first):
        n = first; seen = set()
        while n and n not in seen:
            seen.add(n); b = block(n); nxt = b[2] | b[3]<<8
            for off in range(4, 512, 39):
                e = b[off:off+39]
                if len(e) < 39 or not e[0] & 15: continue
                name = e[1:1+(e[0] & 15)].decode('ascii', 'replace')
                yield name, e, n, off
            n = nxt
    root = list(entries(2))
    modules = [e for name, e, bn, off in root if name == 'MODULES']
    if not modules:
        raise ValueError('MODULES directory not found in ' + str(src_path))
    sub = list(entries(modules[0][17] | modules[0][18] << 8))
    desk = [(name, e, bn, off) for name, e, bn, off in sub if name == 'DESKTOP']
    if not desk:
        raise ValueError('DESKTOP module not found in ' + str(src_path))
    name, entry, dir_blk, dir_off = desk[0]
    key = entry[17] | entry[18] << 8
    size = entry[21] | entry[22] << 8 | entry[23] << 16
    payload = payload_path.read_bytes()
    assert len(payload) == size, f'Size mismatch: payload {len(payload)} vs entry {size}'
    index = bytearray(block(key))
    data_blocks = [index[i] | index[i+256] << 8 for i in range(256)]
    volume_header = block(2)[4:43]
    bitmap_start = volume_header[35] | volume_header[36] << 8
    total_blocks = volume_header[37] | volume_header[38] << 8
    bm_blocks_count = (total_blocks + 4095) // 4096
    bitmap = bytearray(img[bitmap_start*512 : (bitmap_start+bm_blocks_count)*512])
    free = []
    for n in range(total_blocks):
        if bitmap[n//8] & (0x80 >> (n%8)):
            free.append(n)
    
    alloc_count = entry[19] | entry[20] << 8
    for i in range((size + 511) // 512):
        chunk = payload[i*512:(i+1)*512].ljust(512, b'\0')
        n = data_blocks[i]
        if not n:
            if any(chunk):
                n = free.pop(0)
                bitmap[n//8] &= ~(0x80 >> (n%8))
                data_blocks[i] = n
                index[i] = n & 255
                index[i+256] = n >> 8
                alloc_count += 1
                img[bitmap_start*512 : (bitmap_start+bm_blocks_count)*512] = bitmap
                img[key*512 : (key+1)*512] = index
        if n:
            img[n*512:(n+1)*512] = chunk

    entry = bytearray(entry)
    entry[19] = alloc_count & 255
    entry[20] = alloc_count >> 8
    img[dir_blk*512 + dir_off : dir_blk*512 + dir_off + 39] = entry
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    dst_path.write_bytes(img)
    print(f'Wrote {dst_path.name}: {size} bytes in DESKTOP (total {len(img)} bytes, {alloc_count} allocated blocks)')

if __name__ == '__main__':
    payload = Path('vera/build/generated/desktop.built')
    # Floppy 140KB
    inject_desktop(Path('vera/images/A2DeskTop-base.po'), Path('vera/images/A2DeskTop-VERA.po'), payload)
    # Hard Drive 800KB
    inject_desktop(Path('vera/images/A2DeskTop-base.hdv'), Path('vera/images/A2DeskTop-VERA.hdv'), payload)
