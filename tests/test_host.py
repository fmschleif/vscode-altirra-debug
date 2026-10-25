import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from host import entry_from_xex,prepare
from altirra_remote import RemoteSession


class HostTests(unittest.TestCase):
    def test_run_vector_overrides_first_segment(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'game.xex'
            p.write_bytes(b'\xff\xff'+struct.pack('<HH',0x2000,0x2000)+b'\xea'+struct.pack('<HH',0x2e0,0x2e1)+b'\x34\x25')
            self.assertEqual(entry_from_xex(p),0x2534)
            p.write_bytes(b'\xff\xff'+struct.pack('<HH',0x2000,0x2000)+b'\xea')
            self.assertEqual(entry_from_xex(p),0x2000)
            p.write_bytes(b'\xff\xff\0')
            with self.assertRaises(ValueError):entry_from_xex(p)

    def test_private_profile_and_no_png_tracepoints(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);(p/'build').mkdir()
            text=prepare(p,{}).read_text()
            self.assertIn('"Devices" = "[]"',text)
            self.assertIn('"Pause when inactive" = 0',text)
            session=RemoteSession({},p,p,None,None);session.names={'START':0x2000}
            session.write_debug_scripts()
            self.assertNotIn('screen w',(p/'build/ide.atdbg').read_text())
            self.assertNotIn('saveimage',(p/'dap-capture.atdbg').read_text())

    def test_stdio_errors_are_json_and_not_a_server_dependency(self):
        script=Path(__file__).resolve().parents[1]/'backend/host.py'
        request=json.dumps(dict(id=17,command='doctor',body=dict(altirraPath='nonexistent-altirra-debug-test')))+'\n'
        result=subprocess.run([sys.executable,str(script)],input=request,text=True,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        response=json.loads(result.stdout)
        self.assertEqual(response['id'],17)
        self.assertIn('Altirra not found',response['error'])
