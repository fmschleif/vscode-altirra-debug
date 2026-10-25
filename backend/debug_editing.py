"""Paused edit transactions and memory access breakpoints for Altirra DAP."""
import base64
import re
from debug_support import address


class DebugEditing:
    def init_editing(self):
        self.pending_registers={}
        self.pending_memory={}
        self.data_points=[]

    def require_pause(self):
        self.status()
        if self.running or self.last is None:
            raise ValueError('Pause the CPU before editing')

    def set_register(self, body):
        self.require_pause()
        name=str(body['name']).upper()
        if name=='SP': name='S'
        if name not in self.last: raise ValueError('Unknown 6502 register')
        value=address(str(body['value']), {})
        if not 0<=value<=(65535 if name=='PC' else 255):
            raise ValueError('Register value out of range')
        self.pending_registers[name]=value
        self.last[name]=value
        return dict(value='$%X (pending resume)'%value,variablesReference=0)

    def write(self, body):
        self.require_pause()
        start=address(str(body['address']), self.names)+int(body.get('offset',0))
        data=base64.b64decode(body['data'],validate=True)
        if not 1<=len(data)<=4096 or start<0 or start+len(data)>0xC000:
            raise ValueError('Write 1..4096 bytes in CPU RAM $0000..$BFFF; ROM/I/O writes are excluded')
        ram=bytearray(self.ram)
        ram[start:start+len(data)]=data
        for offset,value in enumerate(data): self.pending_memory[start+offset]=value
        self.ram=bytes(ram)
        return dict(offset=int(body.get('offset',0)),bytesWritten=len(data),pending=True)

    def edit_commands(self):
        patches=[]; commands=[]
        for location in sorted(self.pending_memory):
            if not patches or location!=patches[-1][0]+len(patches[-1][1]):
                patches.append((location,bytearray()))
            patches[-1][1].append(self.pending_memory[location])
        for index,(start,data) in enumerate(patches):
            name='dap-patch-%d.bin'%index
            (self.state/name).write_bytes(data)
            commands.append('.readmem %s $%04X L%X'%(name,start,len(data)))
        for name,value in self.pending_registers.items(): commands.append('r %s $%X'%(name.lower(),value))
        return commands

    def range_info(self, body):
        text=str(body.get('name',body.get('address',''))).strip()
        match=re.fullmatch(r'(.+)\[(\d+)\]',text)
        count=body.get('bytes',body.get('length',1))
        if match: text,count=match[1],int(match[2])
        start=address(text,self.names)
        if not isinstance(count,int) or isinstance(count,bool) or not 1<=count<=4096 or start<0 or start+count>65536:
            raise ValueError('Memory range must be 1..4096 bytes within $0000..$FFFF')
        return dict(address=start,length=count)

    def data_info(self, body):
        if body.get('register'): return dict(dataId=None,description='Register access breakpoints are not supported')
        try: info=self.range_info(body)
        except (ValueError,KeyError) as error: return dict(dataId=None,description=str(error))
        return dict(dataId='ram:%d:%d'%(info['address'],info['length']),
                    description='$%04X..$%04X (%d bytes)'%(info['address'],info['address']+info['length']-1,info['length']),
                    accessTypes=['read','write','readWrite'],canPersist=False)

    def set_data_breakpoints(self, body):
        self.status()
        points=[]; results=[]
        requested=body.get('breakpoints',[])
        if len(requested)>32: raise ValueError('At most 32 memory ranges per session')
        for index,point in enumerate(requested):
            try:
                if point.get('condition') or point.get('hitCondition'): raise ValueError('Conditions/hit counts not supported')
                match=re.fullmatch(r'ram:(\d+):(\d+)',point['dataId'])
                if not match: raise ValueError('Invalid memory breakpoint id')
                info=self.range_info(dict(name=str(match[1]),bytes=int(match[2])))
                mode=point.get('accessType','write')
                if mode not in ('read','write','readWrite'): raise ValueError('Invalid access type')
                points.append(dict(**info,mode=mode))
                results.append(dict(id=1000+index,verified=True))
            except (ValueError,KeyError) as error: results.append(dict(verified=False,message=str(error)))
        self.data_points=points
        capture=(self.state/'dap-capture.atdbg').read_text()
        (self.state/'dap-data.atdbg').write_text(capture.replace('.logclose','.echo ADREASON data\n.logclose'))
        if self.running: self.send(self.commands())
        return dict(breakpoints=results)

    def memory_break_commands(self):
        commands=[]
        for point in self.data_points:
            modes=('r','w') if point['mode']=='readWrite' else ('r',) if point['mode']=='read' else ('w',)
            for mode in modes:
                commands.append('ba %s $%04X L%X ".batch dap-data.atdbg"'%(mode,point['address'],point['length']))
        return commands
