"""Persistent, bounded Altirra command IPC via a small Wine-hosted helper."""
import os
import queue
import struct
import subprocess
import threading
import time

GUID=bytes.fromhex('94e23784e9459a4fa77ee8d3aae385a0')


def serialize(commands, directory):
    args=[arg for command in commands for arg in ('/debugcmd',command)]
    def quote(arg):
        if any(c in arg for c in ' \\"'):
            return '"'+arg.replace('\\','\\\\').replace('"','\\"')+'"'
        return arg
    line='altirra-debug-ipc '+ ' '.join(quote(arg) for arg in args)
    # Properties follow the NUL-terminated command line, as in uiinstance.cpp.
    text=line+'\0chdir\0'+directory+'\0'
    return GUID+text.encode('utf-16-le')


class IpcClient:
    def __init__(self, binary, env, directory, wine="wine", target_pid=None):
        self.lock=threading.Lock()
        argv=([wine] if os.name!='nt' else [])+[str(binary)]
        if target_pid is not None: argv+=['--target-pid',str(target_pid)]
        self.process=subprocess.Popen(argv,env=env,cwd=directory,
                                      stdin=subprocess.PIPE,stdout=subprocess.PIPE,bufsize=0)
        self.incoming=queue.Queue()
        self.buffer=bytearray()
        def read_pipe():
            try:
                while True:
                    part=os.read(self.process.stdout.fileno(),65536)
                    self.incoming.put(part)
                    if not part:return
            except OSError:self.incoming.put(b'')
        threading.Thread(target=read_pipe,daemon=True).start()
        try:
            if self._read(4,15)!=struct.pack('<I',0x31425049):
                raise RuntimeError('Invalid IPC helper handshake')
        except Exception:
            self.close();raise

    def _read(self, count, timeout):
        until=time.monotonic()+timeout
        while len(self.buffer)<count:
            left=until-time.monotonic()
            if left<=0:raise TimeoutError('Altirra IPC helper timed out')
            try:part=self.incoming.get(timeout=left)
            except queue.Empty:raise TimeoutError('Altirra IPC helper timed out') from None
            if not part:raise ConnectionError('Altirra IPC helper exited')
            self.buffer.extend(part)
        data=bytes(self.buffer[:count]);del self.buffer[:count]
        return data

    def send(self, commands, directory):
        return self.exchange(serialize(commands,directory))

    def ui(self, operation, vk=0, char=0, flags=0):
        return self.exchange(struct.pack('<5I',0x49555641,operation,vk,char,flags))

    def exchange(self, payload):
        if len(payload)>131072:raise ValueError('IPC command payload too large')
        with self.lock:
            if self.process.poll() is not None:raise ConnectionError('IPC helper not running')
            pending=memoryview(struct.pack('<I',len(payload))+payload)
            while pending:
                count=self.process.stdin.write(pending)
                if not count:raise ConnectionError('IPC helper input closed')
                pending=pending[count:]
            error=struct.unpack('<I',self._read(4,7))[0]
            if error==0xA001:raise RuntimeError('Expected exactly one Altirra instance in the debug Wine prefix')
            if error:raise RuntimeError('Altirra IPC error 0x%X'%error)

    def close(self):
        if self.process.stdin:self.process.stdin.close()
        try:self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.kill();self.process.wait(timeout=2)
        if self.process.stdout:self.process.stdout.close()
