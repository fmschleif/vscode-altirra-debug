"""Paused transactions and range validation; never start Wine."""
import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from altirra_remote import RemoteSession


class EditTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.s=RemoteSession({},Path(self.temp.name),None,None,None)
        self.s.names={'PAGEBUF':0x6000}
        self.s.last=dict(PC=0x2000,A=0,X=0,Y=0,S=0xff,P=0x20)
        self.s.ram=bytes(65536)
        self.s.status=Mock(return_value=dict(stopped=True))
        self.s.send=Mock()
        (self.s.state/'dap-capture.atdbg').write_text('.logopen dap-stop.log\n.logclose\n')

    def test_edits_do_not_send_commands_until_resume(self):
        self.s.set_register(dict(name='A',value='$2A'))
        self.s.write(dict(address='PAGEBUF+5',data=base64.b64encode(b'\x55\x66').decode()))
        self.s.send.assert_not_called()
        self.assertEqual(self.s.last['PC'],0x2000)
        self.assertEqual(self.s.last['A'],42)
        self.assertEqual(self.s.ram[0x6005:0x6007],b'\x55\x66')
        self.s.resume()
        commands=self.s.send.call_args[0][0]
        self.assertIn('r a $2A',commands)
        self.assertIn('.readmem dap-patch-0.bin $6005 L2',commands)
        self.assertEqual((self.s.state/'dap-patch-0.bin').read_bytes(),b'\x55\x66')
        self.assertFalse(self.s.pending_memory)

    def test_breakpoints_rebuild_without_named_groups(self):
        self.s.points={'main.asm':[0x2010]}
        self.s.set_data_breakpoints(dict(breakpoints=[dict(dataId='ram:24576:1',accessType='write')]))
        self.s.resume('step')
        commands=self.s.send.call_args[0][0]
        self.assertEqual(commands[0], 'bc *')
        self.assertIn('bp $2010 ".batch dap-capture.atdbg"', commands)
        self.assertIn('ba w $6000 L1 ".batch dap-data.atdbg"', commands)
        self.assertIn('bx "pc >= 0" ".batch dap-capture.atdbg"', commands)
        self.assertFalse(any('-g ' in c or '.*' in c for c in commands))
        self.s.set_data_breakpoints(dict(breakpoints=[]))
        self.assertFalse(any(c.startswith('ba ') for c in self.s.commands()))

    def test_reject_overflow_rom_io_and_running_edits(self):
        for name,value in [('A','256'),('PC','$10000'),('FAKE','1')]:
            with self.assertRaises(ValueError): self.s.set_register(dict(name=name,value=value))
        for start in ('$C000','$D500','$FFFF','-1'):
            with self.assertRaises(ValueError): self.s.write(dict(address=start,data='AA=='))
        self.s.running=True
        with self.assertRaises(ValueError): self.s.set_register(dict(name='A',value='1'))

    def test_ranges_read_write_and_readwrite(self):
        info=self.s.data_info(dict(name='PAGEBUF[256]'))
        self.assertEqual(info['dataId'],'ram:24576:256')
        self.assertEqual(len(info['accessTypes']),3)
        reply=self.s.set_data_breakpoints(dict(breakpoints=[dict(dataId=info['dataId'],accessType='readWrite')]))
        self.assertTrue(reply['breakpoints'][0]['verified'])
        commands=self.s.commands()
        self.assertTrue(any('ba r $6000 L100' in c for c in commands))
        self.assertTrue(any('ba w $6000 L100' in c for c in commands))
        self.s.send.assert_not_called()
        self.assertIsNone(self.s.data_info(dict(name='$FFF0',bytes=32))['dataId'])


if __name__=='__main__': unittest.main()
