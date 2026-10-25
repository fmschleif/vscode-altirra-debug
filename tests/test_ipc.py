import unittest
from ipc_client import serialize, GUID


class ProtocolTests(unittest.TestCase):
    def test_payload_matches_altirra_command_line_forwarder(self):
        payload=serialize(['bc *','bx "pc >= 0" ".batch capture.atdbg"'],r'Z:\project folder')
        self.assertEqual(payload[:16],GUID)
        text=payload[16:].decode('utf-16-le')
        self.assertTrue(text.startswith('altirra-debug-ipc /debugcmd "bc *" /debugcmd '))
        self.assertIn(r'\"pc >= 0\"',text)
        self.assertTrue(text.endswith('\0chdir\0Z:\\project folder\0'))
        self.assertEqual(len(payload)%2,0)


if __name__=='__main__': unittest.main()


class PipeTests(unittest.TestCase):
    def test_fragmented_messages_and_timeout(self):
        import queue
        from ipc_client import IpcClient
        client=IpcClient.__new__(IpcClient);client.incoming=queue.Queue();client.buffer=bytearray()
        client.incoming.put(b'12');client.incoming.put(b'3456')
        self.assertEqual(client._read(4,.1),b'1234')
        self.assertEqual(client._read(2,.1),b'56')
        with self.assertRaises(TimeoutError):client._read(1,.01)
        client.incoming.put(b'')
        with self.assertRaises(ConnectionError):client._read(1,.1)
