#!/usr/bin/env python3
"""Standalone JSON-lines backend. No sockets, emulated devices or VM service."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
from altirra_remote import RemoteSession
from debug_support import symbols, source_map


def windows_path(path):
    path=str(Path(path).resolve())
    return path if os.name=='nt' else 'Z:'+path.replace('/','\\')


def entry_from_xex(path):
    data=Path(path).read_bytes();offset=0;run={};first=None
    while offset<len(data):
        if data[offset:offset+2]==b'\xff\xff':offset+=2;continue
        if offset+4>len(data):raise ValueError('Truncated XEX segment header')
        start,end=struct.unpack_from('<HH',data,offset);offset+=4
        if end<start or offset+end-start+1>len(data):raise ValueError('Invalid XEX segment')
        payload=data[offset:offset+end-start+1];offset+=len(payload)
        if first is None and start>=0x200:first=start
        for addr in (0x2e0,0x2e1):
            if start<=addr<=end:run[addr]=payload[addr-start]
    if len(run)==2:return run[0x2e0]|run[0x2e1]<<8
    if first is None:raise ValueError('XEX has no executable segment')
    return first


def prepare(state,cfg):
    ini=state/'Altirra.ini'
    ini.write_text('[User\\Software\\virtualdub.org\\Altirra]\n"ShownSetupWizard" = 1\n'
                   '[User\\Software\\virtualdub.org\\Altirra\\Settings]\n'
                   '"Startup: Reuse program instance" = 0\n"Display: Direct3D" = 0\n'
                   '[User\\Software\\virtualdub.org\\Altirra\\Profiles\\00000000]\n'
                   '"Pause when inactive" = 0\n'
                   '"Debugger: Pre-start symbol load mode" = "enabled"\n'
                   '"Debugger: Post-start symbol load mode" = "enabled"\n'
                   '"Debugger: Script auto-load mode" = "enabled"\n"Devices" = "[]"\n')
    return ini


def executable(name,description,wine_program=False):
    if wine_program and name and Path(name).is_file() and os.access(name,os.R_OK):
        return str(Path(name).resolve())
    found=shutil.which(name) if name else None
    if not found:raise ValueError(description+' not found: '+str(name)+'. Configure its executable path in Altirra Debug settings.')
    return found


class Backend:
    def __init__(self):
        self.remote=None;self.lock=threading.RLock();self.cancelled=threading.Event();self.filelock=None

    def own_workspace(self,state):
        self.filelock=(state/'session.lock').open('a+b')
        try:
            if os.name=='nt':
                import msvcrt
                self.filelock.seek(0);self.filelock.write(b'0');self.filelock.flush();self.filelock.seek(0)
                msvcrt.locking(self.filelock.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.filelock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.filelock.close();self.filelock=None
            raise ValueError('Another Altirra Debug session owns this workspace. Stop it first.') from None

    def launch(self,cfg):
        if self.remote:raise ValueError('A debug session is already running')
        workspace=Path(cfg['cwd']).resolve()
        def project_path(value):
            p=Path(value);return (p if p.is_absolute() else workspace/p).resolve()
        storage=Path(cfg['storagePath']).resolve()
        key=hashlib.sha256(str(workspace).encode()).hexdigest()[:20]
        state=storage/'workspaces'/key;state.mkdir(parents=True,exist_ok=True)
        self.own_workspace(state)
        try:
            altirra=executable(cfg.get('altirraPath',''),'Altirra',os.name!='nt')
            wine=executable(cfg.get('winePath','wine'),'Wine') if os.name!='nt' else None
            wineboot=executable(cfg.get('winebootPath','wineboot'),'wineboot') if os.name!='nt' else None
            if os.name not in ('posix','nt') or (sys.platform!='linux' and os.name!='nt'):
                raise ValueError('Supported hosts: Linux/Wine and experimental native Windows')
            app=state/'artifacts';build=app/'build';build.mkdir(parents=True,exist_ok=True)
            output=build/'ide.xex'
            includes=[project_path(p) for p in cfg.get('includePaths',[])]
            source=project_path(cfg.get('source') or cfg.get('program',''))
            if cfg.get('source'):
                if not source.is_file():raise ValueError('Assembly source does not exist: '+str(source))
                args=[executable(cfg.get('atasmPath','atasm'),'ATasm'),str(source)]
                args+=['-I'+str(x) for x in [source.parent,*includes]]
                args+=['-d'+name+'='+str(value) for name,value in cfg.get('defines',{}).items()]
                args+=cfg.get('assemblerArgs',[])
                args+=['-o'+str(output),'-l'+str(output.with_suffix('.lab')),'-g'+str(output.with_suffix('.lst'))]
                subprocess.run(args,cwd=workspace,check=True,timeout=60,stdout=sys.stderr,stderr=sys.stderr)
            else:
                for field,suffix in (('program','.xex'),('symbols','.lab'),('listing','.lst')):
                    original=project_path(cfg[field])
                    if not original.is_file():raise ValueError(field+' file missing: '+str(original))
                    shutil.copyfile(original,output.with_suffix(suffix))
            raw=output.with_suffix('.lst').read_text()
            mapping=source_map(raw,source,[workspace,source.parent,*includes])
            output.with_suffix('.lines.json').write_text(json.dumps([dict(file=file,line=line,address=addr) for (file,line),addresses in mapping.items() for addr in sorted(addresses)]))
            names=symbols(output.with_suffix('.lab'))
            entry=cfg.get('entry')
            if entry:
                if entry.upper() not in names:raise ValueError('Entry label not found: '+entry)
                addr=names[entry.upper()]
            else:addr=entry_from_xex(output)
            # Keep all symbols; an internal alias selects the authoritative entry.
            with output.with_suffix('.lab').open('a') as stream:stream.write('\n%04X __DEBUG_ENTRY\n'%addr)
            remote_cfg=dict(altirra=altirra,wine=wine,wineboot=wineboot,entry='__DEBUG_ENTRY',
                            wine_prefix=str(storage/'wine'/key),hardware=cfg.get('hardware','800xl'),
                            kernel=cfg.get('kernel','lle'),video=cfg.get('video','pal'),debug_transport='persistent')
            if cfg.get('diskRoot'):
                disk_root=project_path(cfg['diskRoot']);disk=build/'ide.atr'
                packer=executable(cfg.get('diskPacker','unix2atr'),'MyDOS disk packer')
                with tempfile.TemporaryDirectory(prefix='disk-',dir=state) as tmp:
                    tree=Path(tmp)/'files';shutil.copytree(disk_root,tree)
                    for old in tree.glob('AUTORUN.*'):old.unlink()
                    shutil.copyfile(output,tree/'AUTORUN.SYS')
                    subprocess.run([packer,'-m',str(cfg.get('diskSectors',720)),str(disk),str(tree)],cwd=workspace,check=True,timeout=60,stdout=sys.stderr,stderr=sys.stderr)
                remote_cfg['disk_image']=str(disk)
            if self.cancelled.is_set():raise RuntimeError('Launch cancelled')
            self.remote=RemoteSession(remote_cfg,state,app,lambda c:prepare(state,c),windows_path)
            self.remote.cancelled=self.cancelled
            self.remote.watch_labels=cfg.get('watchLabels',[])
            self.remote.start()
            return self.state()
        except Exception:
            self.stop();raise

    def state(self):
        result=self.remote.status()
        result['watch_labels']=self.remote.watch_labels
        return result

    def stop(self):
        self.cancelled.set()
        if self.remote:self.remote.stop();self.remote=None
        if self.filelock:self.filelock.close();self.filelock=None
        return {}

    def call(self,command,body):
        if command=='doctor':
            return dict(platform=sys.platform,python=sys.version.split()[0],altirra=executable(body.get('altirraPath',''),'Altirra',os.name!='nt'),atasm=executable(body.get('atasmPath','atasm'),'ATasm'),wine=executable(body.get('winePath','wine'),'Wine') if os.name!='nt' else 'native',helper=(Path(__file__).parent/'native/altirra_ipc.exe').is_file())
        if command in ('stop','dap/stop'):return self.stop()
        with self.lock:
            if command=='launch':return self.launch(body)
            if not self.remote:raise ValueError('No debug session; start debugging first')
            op=command.removeprefix('dap/')
            handlers={'state':lambda:self.state(),'breakpoints':lambda:self.remote.set_breakpoints(body),
                      'resume':lambda:self.remote.resume(body.get('mode','continue')),
                      'read':lambda:self.remote.read(body),'evaluate':lambda:self.remote.evaluate(body),
                      'screen':lambda:self.remote.screen(),'keyboard':lambda:self.remote.keyboard(body),
                      'register':lambda:self.remote.set_register(body),'write':lambda:self.remote.write(body),
                      'range':lambda:self.remote.range_info(body),'data-info':lambda:self.remote.data_info(body),
                      'data-breakpoints':lambda:self.remote.set_data_breakpoints(body),
                      'metrics':lambda:dict(samples=self.remote.timings)}
            if op not in handlers:raise ValueError('Unknown backend operation: '+op)
            return handlers[op]()


def main():
    backend=Backend();outlock=threading.Lock();pool=ThreadPoolExecutor(max_workers=4)
    def execute(request):
        try:message=dict(id=request['id'],result=backend.call(request['command'],request.get('body',{})))
        except Exception as error:message=dict(id=request.get('id'),error=str(error))
        with outlock:print(json.dumps(message),flush=True)
    try:
        for line in sys.stdin:
            if len(line)>1048576:raise ValueError('Request exceeds 1 MiB')
            request=json.loads(line)
            if request.get('command') in ('stop','dap/stop'):
                backend.cancelled.set()
            pool.submit(execute,request)
    finally:
        backend.stop();pool.shutdown(wait=True)


if __name__=='__main__':main()
