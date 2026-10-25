'use strict';
const assert=require('assert');
const {Adapter}=require('../src/adapter');
(async()=>{
 let resolveState;
 const a=new Adapter(async command=>command==='dap/state'?await new Promise(r=>resolveState=r):{},()=>'.');
 const events=[];a.onDidSendMessage(m=>events.push(m));
 a.state={stopped:true};a.generation=1;
 const oldPoll=a.poll();
 await a.resume('next');
 resolveState({stopped:true,generation:1});await oldPoll;
 assert.equal(a.state.stopped,false,'pre-step response must not overwrite resumed state');
 // A stackTrace request can already have cached the new stop before polling.
 a.state={stopped:true,generation:2};
 const newPoll=a.poll();resolveState({stopped:true,generation:2});await newPoll;
 assert.equal(events.filter(m=>m.event==='stopped').length,1,'cached stop still needs notification');
 const repeat=a.poll();resolveState({stopped:true,generation:2});await repeat;
 assert.equal(events.filter(m=>m.event==='stopped').length,1);
 a.dispose();console.log('PASS: stale poll during F10, cached stop notification, no duplicate stop');
})().catch(e=>{console.error(e);process.exitCode=1;});
