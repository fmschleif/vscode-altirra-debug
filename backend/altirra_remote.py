"""Experimental Altirra 4.10 command-line IPC backend, isolated by WINEPREFIX.
Display-only surface capture and directed keyboard events; no global input injection. Register edits cancel the automatic
IPC resume by staging changes until the next explicit execution request; RAM inspection uses stop snapshots.
"""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import time
import threading
import sys
from debug_support import symbols, address
from ipc_client import IpcClient
from debug_editing import DebugEditing
from display_frame import bmp_to_png


class RemoteSession(DebugEditing):
    def __init__(self, cfg, state, app, prepare, winepath):
        self.cfg, self.state, self.app = cfg, state, app
        self.prepare, self.winepath = prepare, winepath
        self.prefix = Path(cfg.get('wine_prefix',state/'wine-debug')).resolve()
        self.env = dict(os.environ, WINEPREFIX=str(self.prefix),
                        WINEDLLOVERRIDES='mscoree,mshtml=', WINEDEBUG='-all',WINEARCH='win64')
        self.process = None
        self.setup_process = None
        self.cancelled = threading.Event()
        self.points = {}
        self.running = False
        self.seen = None
        self.last = None
        self.generation = 0
        self.ipc = None
        self.timings = []
        self.last_image = None
        self.init_editing()
        self.stop_reason = "breakpoint"

    def send(self, commands):
        if not self.process or self.process.poll() is not None:
            raise ValueError('Debug emulator is not running')
        started=time.perf_counter()
        transport=self.cfg.get('debug_transport','persistent')
        if transport=='persistent':
            if self.ipc is None:
                binary=Path(__file__).parent/'native/altirra_ipc.exe'
                self.ipc=IpcClient(binary,self.env,self.state,wine=self.cfg.get('wine','wine'),target_pid=self.process.pid if os.name=='nt' else None)
            self.ipc.send(commands,self.winepath(self.state))
        elif transport=='cli':
            argv = ([self.cfg.get('wine','wine')] if os.name!='nt' else [])+[ self.cfg['altirra'], '/singleinstance']
            for command in commands:
                argv += ['/debugcmd', command]
            subprocess.run(argv, env=self.env, cwd=self.state, check=True, timeout=15,
                           stdout=subprocess.DEVNULL)
        else:
            raise ValueError('Unknown debug_transport')
        self.timings.append(dict(transport=transport,commands=len(commands),
                                 ipc_seconds=time.perf_counter()-started))

    def start(self):
        if self.cancelled.is_set():raise RuntimeError('Debug start cancelled')
        self.prefix.parent.mkdir(parents=True,exist_ok=True)
        if os.name!='nt' and not (self.prefix/'system.reg').exists():
            print('Setting up private Wine prefix (first launch only)...',file=sys.stderr,flush=True)
            setup=subprocess.Popen([self.cfg.get('wineboot','wineboot'),'-u'],env=self.env,stdout=sys.stderr,stderr=sys.stderr)
            self.setup_process=setup;deadline=time.monotonic()+90
            try:
                while setup.poll() is None:
                    if self.cancelled.is_set():raise RuntimeError('Debug start cancelled')
                    if time.monotonic()>deadline:raise TimeoutError('Private Wine setup timed out')
                    time.sleep(.05)
                if setup.returncode:raise RuntimeError('Private Wine setup failed; see Output logs')
            finally:
                if setup.poll() is None:
                    setup.terminate()
                    try:setup.wait(timeout=5)
                    except subprocess.TimeoutExpired:setup.kill();setup.wait(timeout=5)
                self.setup_process=None
        if self.cancelled.is_set():
            raise RuntimeError('Debug start cancelled')
        self.names = symbols(self.app/'build/ide.lab')
        self.lines = json.loads((self.app/'build/ide.lines.json').read_text())
        (self.state/'dap-stop.log').unlink(missing_ok=True)
        (self.state/'atari-display.png').unlink(missing_ok=True)
        self.write_debug_scripts()
        ini = self.prepare(self.cfg)
        media_args=(['/bootvrw','/disk',self.winepath(self.cfg['disk_image']),
                     '/debugcmd','.batch "'+self.winepath(self.app/'build/ide.atdbg')+'"']
                    if self.cfg.get('disk_image') else ['/run',self.winepath(self.app/'build/ide.xex')])
        self.process = subprocess.Popen(([self.cfg.get('wine','wine')] if os.name!='nt' else [])+[
            self.cfg['altirra'], '/portablealt', self.winepath(ini),
            '/nosingleinstance','/autotest','/hardware:'+self.cfg.get('hardware','800xl'),'/kernel:'+self.cfg.get('kernel','lle'),'/memsize:64K','/nobasic','/'+self.cfg.get('video','pal'),
            *media_args],env=self.env,cwd=self.state,stdout=sys.stderr,stderr=sys.stderr)
        started=time.monotonic()
        print('DAP: waiting for Altirra startup (up to 60 seconds)',flush=True,file=sys.stderr)
        try:
            self.wait_stop(timeout=60)
        except Exception:
            self.stop()
            raise
        print('DAP: stopped at %s after %.2f seconds' % (self.cfg.get('entry','START'),time.monotonic()-started),flush=True,file=sys.stderr)
        if self.cfg.get('debug_transport','persistent')=='persistent':
            self.ipc=IpcClient(Path(__file__).parent/'native/altirra_ipc.exe',self.env,self.state,wine=self.cfg.get('wine','wine'),target_pid=self.process.pid if os.name=='nt' else None)
        return self.status()

    def write_debug_scripts(self):
        legacy=self.cfg.get('debug_transport','persistent')=='cli'
        (self.state/'dap-capture.atdbg').write_text(
            '.logopen dap-stop.log\n'
            '.printf "ADREG %04X %02X %02X %02X %02X %02X" pc @a x y s p\n'
            '.writemem atari-ram.bin 0 L10000\n.logclose\n'+
            ('.autotest_saveimage atari-display.png\n' if legacy else ''))
        (self.app/'build/ide.atdbg').write_text(
            ('ba -n -q -g screen w $14 \".autotest_saveimage atari-display.png\"\n'
            'bsc screen.0 \"(@frame % 10) = 0\"\n' if legacy else '')+
            'bp -o $%04X ".batch dap-capture.atdbg"\n' % self.names[self.cfg.get('entry','START').upper()])

    def wait_stop(self, timeout=60):
        until = time.monotonic()+timeout
        while time.monotonic()<until:
            if self.cancelled.is_set():
                raise RuntimeError('Debug start cancelled')
            result=self.status()
            if result.get('terminated'):
                raise RuntimeError('Altirra exited before its first breakpoint; see host.log')
            if result.get('stopped'):
                return result
            time.sleep(.04)
        raise TimeoutError('Altirra did not reach START within 60 seconds; see backend logs and emulator dialogs')

    def status(self):
        if self.process and self.process.poll() is not None:
            return dict(terminated=True)
        try:
            file=self.state/'dap-stop.log'
            stamp=file.stat().st_mtime_ns
            if stamp!=self.seen:
                match=re.search(r'ADREG ([0-9A-Fa-f]{4})((?: [0-9A-Fa-f]{2}){5})',file.read_text())
                ram=(self.state/'atari-ram.bin').read_bytes()
                if match and len(ram)==65536:
                    values=[int(x,16) for x in match[0].split()[1:]]
                    self.last=dict(zip(('PC','A','X','Y','S','P'),values))
                    self.ram=ram
                    self.seen=stamp
                    self.running=False
                    self.generation+=1
                    self.stop_reason="data breakpoint" if "ADREASON data" in file.read_text() else "breakpoint"
        except OSError:
            pass
        return dict(stopped=not self.running and self.last is not None,
                    generation=self.generation, registers=self.last,
                    reason=self.stop_reason,pending_registers=list(self.pending_registers),
                    pending_edits=len(self.pending_registers)+len(self.pending_memory),
                    location=self.location(self.last['PC']) if self.last else None,
                    transport=self.cfg.get('debug_transport','persistent'),
                    last_ipc_seconds=self.timings[-1]['ipc_seconds'] if self.timings else None)

    def location(self, pc):
        # Exact instruction address only: never highlight an unrelated source line.
        matches=[line for line in self.lines if line['address']==pc]
        return matches[0] if matches else None

    def set_breakpoints(self, body):
        source=str(Path(body['source']).resolve())
        result=[]; found=[]
        for point in body.get('breakpoints',[]):
            line=int(point['line'])
            matches={item['address'] for item in self.lines if item['file']==source and item['line']==line}
            valid=len(matches)==1 and not any(point.get(k) for k in ('condition','hitCondition','logMessage'))
            item=dict(verified=valid,line=line)
            if valid:
                item['instructionReference']='0x%04X' % next(iter(matches))
                found.extend(matches)
            else:
                item['message']='Choose an unambiguous instruction line; conditions/logpoints not supported'
            result.append(item)
        self.points[source]=found
        # While paused, apply on resume without executing an instruction now.
        if self.running:
            self.send(self.commands())
        return dict(breakpoints=result)

    def commands(self):
        # Altirra 4.10 named-group deletion can retain stale indices.
        # This isolated session owns all numbered breakpoints; rebuild them together.
        cmds=['bc *']
        for point in sorted({x for points in self.points.values() for x in points}):
            cmds.append('bp $%04X ".batch dap-capture.atdbg"' % point)
        return cmds+self.memory_break_commands()

    def resume(self, mode='continue'):
        self.status()
        if mode!='pause' and self.running:
            raise ValueError('Pause before stepping')
        commands=self.commands()+self.edit_commands()
        if mode in ('step','next','pause'):
            pc=self.last['PC'] if self.last else None
            # The conditional breakpoint fires at the next instruction boundary;
            # Altirra resumes past the current instruction at an existing stop.
            if mode=='next' and pc is not None and self.ram[pc]==0x20:
                commands.append('bp -o $%04X ".batch dap-capture.atdbg"' % ((pc+3)&65535))
            else:
                commands.append('bx "pc >= 0" ".batch dap-capture.atdbg"')
        if mode not in ('continue','step','next','pause'):
            raise ValueError('Unsupported resume mode')
        self.running=True
        try: self.send(commands)
        except Exception:
            self.running=False
            raise
        self.pending_registers.clear()
        self.pending_memory.clear()
        return dict(allThreadsContinued=True)

    def read(self, body):
        self.status()
        if self.running or self.last is None:
            raise ValueError('RAM is available while paused')
        start=address(str(body['address']),self.names)+int(body.get('offset',0))
        count=int(body.get('count',64))
        if not 1<=count<=4096 or not 0<=start<65536 or start+count>65536:
            raise ValueError('Invalid memory range')
        return dict(address='0x%04X'%start,data=base64.b64encode(self.ram[start:start+count]).decode())

    def evaluate(self, body):
        self.status()
        if self.running or self.last is None:
            raise ValueError('Pause before evaluating')
        text=body['expression'].strip()
        if text.upper() in self.last:
            value=self.last[text.upper()]
            return dict(result='$%X (%d)'%(value,value),variablesReference=0)
        start=address(text,self.names)
        if not 0<=start<65536:
            raise ValueError('Address out of bounds')
        value=self.ram[start]
        return dict(result='$%02X (%d), at $%04X'%(value,value,start),variablesReference=0,
                    memoryReference='0x%04X'%start)

    def keyboard(self, body):
        if self.ipc is None: raise ValueError('Keyboard requires the persistent debug transport')
        action=body.get('action')
        if action=='release': self.ipc.ui(3)
        elif action=='key':
            self.status()
            if not self.running and body.get('down') is True: raise ValueError('Continue the CPU before typing into the Atari')
            vk=body.get('vk');char=body.get('char',0)
            if type(vk) is not int or not 1<=vk<=255 or type(char) is not int or not 0<=char<=65535:
                raise ValueError('Invalid keyboard event')
            self.ipc.ui(2,vk,char,(1 if body.get('down') is True else 0)|(2 if body.get('repeat') is True else 0))
        else: raise ValueError('Invalid keyboard action')
        return dict(delivered=True)

    def screen(self):
        self.status()
        if self.ipc is not None:
            try:
                self.ipc.ui(1)
                file=self.state/'native-display.bmp'
                png=bmp_to_png(file.read_bytes())
                self.last_image=dict(png=base64.b64encode(png).decode(),
                                     sequence=str(file.stat().st_mtime_ns),source='display-surface')
                return dict(available=True,running=self.running,**self.last_image)
            except (OSError,ValueError,RuntimeError,TimeoutError):
                if self.last_image is not None:
                    return dict(available=True,running=self.running,**dict(self.last_image,source='cached-display'))
        file=self.state/'atari-display.png'
        try:
            stat=file.stat()
            data=file.read_bytes()
            # PNG is rewritten in place; never publish a partially written frame.
            if (data.startswith(b'\x89PNG\r\n\x1a\n') and
                    data.endswith(b'\x00\x00\x00\x00IEND\xaeB`\x82') and
                    stat.st_mtime_ns==file.stat().st_mtime_ns):
                self.last_image=dict(png=base64.b64encode(data).decode(),
                                     sequence=str(stat.st_mtime_ns),source='completed-frame')
        except OSError:
            pass
        if self.last_image is None:
            return dict(available=False)
        return dict(available=True,running=self.running,**self.last_image)

    def stop(self):
        self.cancelled.set()
        if self.setup_process and self.setup_process.poll() is None:
            self.setup_process.terminate()
        if self.ipc:
            try: self.ipc.ui(3)
            except Exception: pass
            self.ipc.close(); self.ipc=None
        process, self.process = self.process, None
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
        return {}
