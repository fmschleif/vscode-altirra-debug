import struct
import unittest
import zlib
from display_frame import bmp_to_png


class FrameTests(unittest.TestCase):
    def image(self,height):
        header=struct.pack('<2sIHHI',b'BM',62,0,0,54)
        info=struct.pack('<IiiHHIIiiII',40,1,height,1,32,0,8,0,0,0,0)
        return header+info+bytes([0,0,255,0,255,0,0,0])

    def pixels(self,png):
        offset=8;compressed=b''
        while offset<len(png):
            length=struct.unpack_from('>I',png,offset)[0];kind=png[offset+4:offset+8]
            if kind==b'IDAT':compressed+=png[offset+8:offset+8+length]
            offset+=length+12
        return zlib.decompress(compressed)

    def test_bgra_colors_and_both_row_orders(self):
        self.assertEqual(self.pixels(bmp_to_png(self.image(-2))),b'\0\xff\0\0\0\0\0\xff')
        self.assertEqual(self.pixels(bmp_to_png(self.image(2))),b'\0\0\0\xff\0\xff\0\0')

    def test_reject_truncated_or_unsupported_frame(self):
        for data in (b'',self.image(-2)[:-1],self.image(16000)):
            with self.assertRaises(ValueError):bmp_to_png(data)
