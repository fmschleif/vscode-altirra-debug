'use strict';
const {EventEmitter}=require('events');
const path=require('path');
const {Editing}=require('./editing');

class Adapter {
    constructor(control, appFolder) {
        this.control=control; this.appFolder=appFolder;
        this.events=new EventEmitter(); this.seq=1; this.chain=Promise.resolve();
        this.editing=new Editing(this);
        this.execution=0; this.resuming=false; this.generation=-1; this.polling=false; this.disposed=false;
        this.onDidSendMessage=listener=>{this.events.on('message',listener);return {dispose:()=>this.events.off('message',listener)};};
    }
    send(message) {if(!this.disposed)this.events.emit('message',{seq:this.seq++,...message});}
    event(event,body={}) {this.send({type:'event',event,body});}
    respond(request,body={}) {this.send({type:'response',request_seq:request.seq,command:request.command,success:true,body});}
    handleMessage(request) {
        if(this.launching && ['disconnect','terminate','cancel'].includes(request.command)) {
            this.control('dap/stop').catch(()=>{}).finally(()=>{
                this.respond(request);this.event('terminated');
            });
            return;
        }
        this.chain=this.chain.then(()=>this.dispatch(request)).catch(error=>{
            this.send({type:'response',request_seq:request.seq,command:request.command,success:false,message:error.message});
        });
    }
    async dispatch(r) {
        if(await this.editing.handle(r))return;
        const a=r.arguments||{};
        switch(r.command) {
        case 'initialize': return this.respond(r,{
            supportsConfigurationDoneRequest:true,supportsReadMemoryRequest:true,
            supportsEvaluateForHovers:true,
            supportsTerminateRequest:true,supportsWriteMemoryRequest:true,
            supportsDataBreakpoints:true,supportsDataBreakpointBytes:true,supportsSetExpression:true,
            supportsSetVariable:true,supportsStepBack:false,supportsConditionalBreakpoints:false
        });
        case 'launch': {
            this.stopOnEntry=!!a.stopOnEntry;
            this.event('output',{category:'console',output:'Altirra Debug DAP prototype: use VS Code run controls while attached. Edits are staged until resume. Step Out is not implemented.\n'});
            this.launching=true;
            try {await this.control('launch',a);} finally {this.launching=false;}
            this.state=await this.control('dap/state');
            this.generation=this.state.generation;
            this.respond(r); this.event('initialized'); return;
        }
        case 'setBreakpoints': return this.respond(r,await this.control('dap/breakpoints',{
            source:a.source.path,breakpoints:a.breakpoints||[]}));
        case 'configurationDone':
            if(this.stopOnEntry)this.event('stopped',{reason:'entry',threadId:1,allThreadsStopped:true});
            else await this.resume('continue');
            this.timer=setInterval(()=>this.poll(),40);this.respond(r);return;
        case 'threads': return this.respond(r,{threads:[{id:1,name:'Atari 6502'}]});
        case 'stackTrace': {
            const state=await this.control('dap/state'); this.state=state;
            if(!state.stopped)throw Error('CPU is running');
            const pc=state.registers.PC, loc=state.location;
            const frame={id:1,name:loc?`${path.basename(loc.file)}:${loc.line}`:`6502 at $${pc.toString(16)}`,
                line:loc?loc.line:1,column:1,instructionPointerReference:'0x'+pc.toString(16)};
            if(loc)frame.source={name:path.basename(loc.file),path:loc.file};
            return this.respond(r,{stackFrames:[frame],totalFrames:1});
        }
        case 'scopes': return this.respond(r,{scopes:[
            {name:'6502 Registers',variablesReference:1,expensive:false,presentationHint:'registers'},
            {name:'Memory Labels',variablesReference:2,expensive:false}
        ]});
        case 'variables': {
            const state=await this.control('dap/state');
            if(!state.stopped)throw Error('CPU is running');
            const variables=[];
            if(a.variablesReference===1) {
                for(const [name,value] of Object.entries(state.registers))variables.push({name,
                    value:'$'+value.toString(16).toUpperCase().padStart(name==='PC'?4:2,'0')+((state.pending_registers||[]).includes(name)?' (pending resume)':''),
                    type:name==='PC'?'address':'byte',variablesReference:0});
            } else if(a.variablesReference===2) {
                for(const name of (state.watch_labels||[])) {
                    try {const value=await this.control('dap/evaluate',{expression:name});variables.push({name,value:value.result,variablesReference:0,memoryReference:value.memoryReference});}
                    catch(_) {} // A label may not exist in this build.
                }
            }
            return this.respond(r,{variables});
        }
        case 'evaluate': return this.respond(r,await this.control('dap/evaluate',{expression:a.expression}));
        case 'readMemory': return this.respond(r,await this.control('dap/read',{
            address:a.memoryReference,offset:a.offset||0,count:a.count}));
        case 'continue': case 'next': case 'stepIn': case 'pause': {
            const mode={continue:'continue',next:'next',stepIn:'step',pause:'pause'}[r.command];
            await this.resume(mode);return this.respond(r,{allThreadsContinued:true});
        }
        case 'disconnect': case 'terminate':
            clearInterval(this.timer);
            await this.control('dap/stop');this.respond(r);this.event('terminated');return;
        case 'setExceptionBreakpoints': return this.respond(r,{breakpoints:[]});
        case 'source': throw Error('Source files are read from the workspace');
        default: throw Error('Unsupported debug request: '+r.command);
        }
    }
    async resume(mode) {
        this.execution++;
        this.resuming=true;
        try {
            await this.control('dap/resume',{mode});
            if(this.state)this.state={...this.state,stopped:false};
            this.event('continued',{threadId:1,allThreadsContinued:true});
        } finally {this.resuming=false;}
    }
    async poll() {
        if(this.polling||this.disposed||this.resuming)return;
        this.polling=true;
        const execution=this.execution;
        try {
            const state=await this.control('dap/state');
            if(this.disposed||this.resuming||execution!==this.execution)return;
            this.state=state;
            if(state.terminated) {clearInterval(this.timer);this.event('terminated');}
            else if(state.stopped&&state.generation!==this.generation) {
                this.generation=state.generation;
                this.event('stopped',{reason:state.reason||'breakpoint',threadId:1,allThreadsStopped:true});
            }
        } catch(error) {
            clearInterval(this.timer);this.event('output',{category:'stderr',output:error.message+'\n'});
            this.event('terminated');
        } finally {this.polling=false;}
    }
    dispose() {this.disposed=true;clearInterval(this.timer);this.events.removeAllListeners();}
}
module.exports={Adapter};
