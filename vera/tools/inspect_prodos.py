from pathlib import Path
src = Path('out/A2DeskTop.po')
dst = Path('vera/images/A2DeskTop-VERA.po')
dst.parent.mkdir(parents=True, exist_ok=True)
img = bytearray(src.read_bytes())
def block(n): return img[n*512:(n+1)*512]
def entries(first):
    n=first; seen=set()
    while n and n not in seen:
        seen.add(n); b=block(n); nxt=b[2] | b[3]<<8
        for off in range(4,512,39):
            e=b[off:off+39]
            if len(e)<39 or not e[0]&15: continue
            name=e[1:1+(e[0]&15)].decode('ascii','replace')
            yield name,e
        n=nxt
root=list(entries(2))
print([(name, hex(e[0]>>4), e[17]|e[18]<<8) for name,e in root])
modules=next(e for name,e in root if name=='MODULES')
print('Modules entry', list(modules[:24]))
sub=list(entries(modules[17]|modules[18]<<8))
print([(name, hex(e[0]>>4), e[16], e[17]|e[18]<<8, e[19]|e[20]<<8, e[21]|e[22]<<8|e[23]<<16) for name,e in sub])
entry=next(e for name,e in sub if name=='DESKTOP')
key=entry[17]|entry[18]<<8
size=entry[21]|entry[22]<<8|entry[23]<<16
payload=Path('out/desktop.built').read_bytes()
assert len(payload)==size, (len(payload),size)
index=block(key)
data_blocks=[index[i] | index[i+256]<<8 for i in range(256)]
volume_header=block(2)[4:43]
bitmap_start=volume_header[35] | volume_header[36]<<8
total_blocks=volume_header[37] | volume_header[38]<<8
bitmap=bytearray(block(bitmap_start))
free=[]
for n in range(total_blocks):
    if bitmap[n//8] & (0x80 >> (n%8)):
        free.append(n)
for i in range((size+511)//512):
    chunk=payload[i*512:(i+1)*512].ljust(512,b'\0')
    n=data_blocks[i]
    if not n:
        if any(chunk):
            n=free.pop(0)
            bitmap[n//8] &= ~(0x80 >> (n%8))
            data_blocks[i]=n
            index[i]=n&255; index[i+256]=n>>8
            entry[19] += 1
            img[bitmap_start*512:(bitmap_start+1)*512]=bitmap
            img[key*512:(key+1)*512]=index
    if n:
        img[n*512:(n+1)*512]=chunk
subdir_block=modules[17]|modules[18]<<8
for name,e in sub:
    if name=='DESKTOP':
        for j in range(39): img[subdir_block*512+43+j]=e[j]
dst.write_bytes(img)
print('Wrote same-size DESKTOP module in place:',size,'bytes;',sum(bool(x) for x in data_blocks[:(size+511)//512]),'allocated blocks')
