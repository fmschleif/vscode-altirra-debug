'use strict';
const {spawn}=require('child_process');
const path=require('path');
const readline=require('readline');
class Backend {
    constructor(root,python,onLog=()=>{}) {this.root=root;this.python=python;this.onLog=onLog;this.pending=new Map();this.sequence=0;this.closed=false;}
    start() {
        if(this.child)return;
        if(this.closed)throw Error('Debug backend is closed');
        this.child=spawn(this.python,[path.join(this.root,'backend','host.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
        this.child.stderr.on('data',chunk=>this.onLog(chunk.toString()));
        this.child.stdin.on('error',error=>this.fail(error));
        this.child.on('error',error=>this.fail(Error('Cannot start Python backend: '+error.message)));
        this.child.on('exit',(code,signal)=>this.fail(Error(`Backend exited (${signal||code})`)));
        this.lines=readline.createInterface({input:this.child.stdout});
        this.lines.on('line',line=>{
            let message;
            try {message=JSON.parse(line);} catch(_) {this.onLog('Invalid backend output: '+line+'\n');return;}
            const wait=this.pending.get(message.id);if(!wait)return;
            this.pending.delete(message.id);clearTimeout(wait.timer);
            message.error?wait.reject(Error(message.error)):wait.resolve(message.result);
        });
    }
    fail(error) {for(const wait of this.pending.values()){clearTimeout(wait.timer);wait.reject(error);}this.pending.clear();}
    call(command,body={}) {
        try {this.start();}catch(error){return Promise.reject(error);}
        const id=++this.sequence;
        return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Backend request timed out: '+command));},command==='launch'?180000:15000);
            this.pending.set(id,{resolve,reject,timer});
            this.child.stdin.write(JSON.stringify({id,command,body})+'\n');
        });
    }
    async close() {
        if(this.closed)return;this.closed=true;
        if(!this.child)return;
        try {await this.call('dap/stop');} catch(_) {}
        this.child.stdin.end();
        const child=this.child;
        const timer=setTimeout(()=>child.kill(),5000);timer.unref();
        child.once('exit',()=>clearTimeout(timer));
    }
}
module.exports={Backend};
