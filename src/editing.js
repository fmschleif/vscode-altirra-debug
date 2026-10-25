'use strict';
// DAP memory editing/range features, kept separate from transport/display code.
class Editing {
    constructor(adapter) {this.adapter=adapter;this.ranges=new Map();this.nextRange=100;}
    async call(command,body) {return this.adapter.control('dap/'+command,body);}
    index(name,length) {
        const match=/^\[(\d+)\]$/.exec(name);
        if(!match||Number(match[1])>=length)throw Error('Invalid array index');
        return Number(match[1]);
    }
    byte(text) {
        text=text.trim();
        if(!/^(\$[0-9a-f]+|0x[0-9a-f]+|[0-9]+)$/i.test(text))throw Error('Use $hex, 0xhex or decimal');
        const value=Number(text.replace(/^\$/,'0x'));
        if(value<0||value>255)throw Error('Byte must be 0..255');
        return value;
    }
    edited() {
        if(this.invalidated)this.adapter.event('invalidated',{areas:['all']});
        this.adapter.event('output',{category:'console',output:'Edit staged; applied before the next CPU step/continue. CPU remains paused.\n'});
    }
    async handle(r) {
        const a=r.arguments||{},adapter=this.adapter;
        switch(r.command) {
        case 'initialize': this.invalidated=!!a.supportsInvalidatedEvent;return false;
        case 'launch': this.ranges.clear();this.nextRange=100;return false;
        case 'dataBreakpointInfo': {
            let name=a.name;
            const range=this.ranges.get(a.variablesReference);
            if(range)name='0x'+(range.address+this.index(a.name,range.length)).toString(16);
            adapter.respond(r,await this.call('data-info',{name,bytes:a.bytes??1,register:a.variablesReference===1}));return true;
        }
        case 'setDataBreakpoints': adapter.respond(r,await this.call('data-breakpoints',a));return true;
        case 'variables': {
            const range=this.ranges.get(a.variablesReference);
            if(!range)return false;
            const start=Math.max(0,a.start||0),count=Math.min(a.count||range.length,range.length-start),variables=[];
            if(count>0) {
                const result=await this.call('read',{address:String(range.address+start),count});
                const data=Buffer.from(result.data,'base64');
                for(let i=0;i<data.length;i++)variables.push({name:`[${start+i}]`,value:'$'+data[i].toString(16).toUpperCase().padStart(2,'0'),
                    evaluateName:'$'+(range.address+start+i).toString(16),memoryReference:'0x'+(range.address+start+i).toString(16),variablesReference:0});
            }
            adapter.respond(r,{variables});return true;
        }
        case 'evaluate': {
            if(!/^.+\[\d+\]$/.test(a.expression))return false;
            const state=await this.call('state');if(!state.stopped)throw Error('Pause before evaluating');
            const range=await this.call('range',{name:a.expression});
            let id=[...this.ranges.entries()].find(([,x])=>x.address===range.address&&x.length===range.length)?.[0];
            if(!id) {if(this.ranges.size>=256)throw Error('At most 256 range watches per session');id=this.nextRange++;this.ranges.set(id,range);}
            adapter.respond(r,{result:`${range.length} bytes at $${range.address.toString(16).toUpperCase()}`,type:'byte[]',
                variablesReference:id,indexedVariables:range.length,memoryReference:'0x'+range.address.toString(16)});return true;
        }
        case 'setVariable': {
            let body;
            if(a.variablesReference===1)body=await this.call('register',{name:a.name,value:a.value});
            else {
                const range=this.ranges.get(a.variablesReference);
                const address=range?String(range.address+this.index(a.name,range.length)):a.name;
                if(!range&&a.variablesReference!==2)throw Error('Unknown variable scope');
                await this.call('write',{address,data:Buffer.from([this.byte(a.value)]).toString('base64')});
                body={value:a.value+' (pending resume)',variablesReference:0};
            }
            this.edited();adapter.respond(r,body);return true;
        }
        case 'setExpression': {
            let body;
            if(/^(PC|A|X|Y|S|SP|P)$/i.test(a.expression))body=await this.call('register',{name:a.expression,value:a.value});
            else {
                await this.call('write',{address:a.expression,data:Buffer.from([this.byte(a.value)]).toString('base64')});
                body={value:a.value+' (pending resume)',variablesReference:0};
            }
            this.edited();adapter.respond(r,body);return true;
        }
        case 'writeMemory': {
            const result=await this.call('write',{address:a.memoryReference,offset:a.offset||0,data:a.data});
            this.edited();adapter.respond(r,result);return true;
        }
        default:return false;
        }
    }
}
module.exports={Editing};
