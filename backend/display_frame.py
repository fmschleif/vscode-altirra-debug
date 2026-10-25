"""Decode the helper's bounded 32-bit display-only DIB without third-party libs."""
import struct
import zlib


def bmp_to_png(data):
    if len(data)<54 or data[:2]!=b'BM':raise ValueError('Invalid display BMP')
    offset=struct.unpack_from('<I',data,10)[0]
    size,w,h,planes,bits,compression=struct.unpack_from('<IiiHHI',data,14)
    if size!=40 or planes!=1 or bits!=32 or compression!=0 or not 1<=w<=2048 or not 1<=abs(h)<=1536:
        raise ValueError('Unsupported display BMP')
    height=abs(h);stride=w*4
    if offset<54 or len(data)!=offset+stride*height:raise ValueError('Truncated display BMP')
    rows=[]
    for y in range(height):
        row=y if h<0 else height-1-y
        bgra=data[offset+row*stride:offset+(row+1)*stride]
        rgb=bytearray(w*3);rgb[0::3]=bgra[2::4];rgb[1::3]=bgra[1::4];rgb[2::3]=bgra[0::4]
        rows.append(b'\0'+rgb)
    def chunk(kind,payload):
        return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),1))+chunk(b'IEND',b'')
