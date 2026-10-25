// Optional real Altirra test. This is not run by the portable unit-test suite.
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {Backend}=require('../src/backend');const {Adapter}=require('../src/adapter');
const root=path.resolve(__dirname,'..');
const argv=process.argv.slice(2);
function option(name,otherwise){const i=argv.indexOf(name);return i<0?otherwise:argv[i+1];}
const altirra=option('--altirra',process.env.ALTIRRA_PATH);
if(!altirra){console.error('Usage: node tests/integration.js --altirra /path/to/Altirra64.exe');process.exit(2);}
const workspace=path.join(os.tmpdir(),'altirra-debug-example with spaces');fs.mkdirSync(workspace,{recursive:true});
fs.copyFileSync(path.join(root,'examples/hello/main.asm'),path.join(workspace,'main.asm'));
const config={cwd:workspace,source:path.join(workspace,'main.asm'),altirraPath:altirra,atasmPath:option('--atasm','atasm'),
 storagePath:option('--storage',path.join(os.tmpdir(),'altirra-debug standalone cache')),watchLabels:['COUNTER','OBSERVED','LASTCONSOLE']};
let logs='';const backend=new Backend(root,process.env.PYTHON||(process.platform==='win32'?'python':'python3'),text=>{logs+=text;});
const adapter=new Adapter((command,body)=>backend.call(command,command==='launch'?{...config,...body}:body),()=>workspace);
let sequence=0;const pending=new Map(),events=[];
adapter.onDidSendMessage(m=>{if(m.type==='response'){const wait=pending.get(m.request_seq);if(wait){pending.delete(m.request_seq);m.success?wait.resolve(m.body):wait.reject(Error(m.message));}}else events.push(m);});
function request(command,args={}){return new Promise((resolve,reject)=>{const seq=++sequence;pending.set(seq,{resolve,reject});adapter.handleMessage({seq,type:'request',command,arguments:args});});}
async function stopped(){const end=Date.now()+15000;while(Date.now()<end){const i=events.findIndex(e=>e.event==='stopped');if(i>=0)return events.splice(i,1)[0];await new Promise(r=>setTimeout(r,20));}throw Error('No stopped event');}
const source={path:config.source};const text=fs.readFileSync(config.source,'utf8').split('\n');
const breakpoint=async label=>{const result=await request('setBreakpoints',{source,breakpoints:label?[{line:text.findIndex(x=>x.startsWith(label+' '))+1}]:[]});if(label)assert(result.breakpoints[0].verified,JSON.stringify(result));return result;};
async function key(vk,char=0){await new Promise(r=>setTimeout(r,500));await backend.call('dap/keyboard',{action:'key',vk,char,down:true});await new Promise(r=>setTimeout(r,500));await backend.call('dap/keyboard',{action:'release'});}
(async()=>{
 try {
  await request('initialize',{supportsInvalidatedEvent:true});
  await request('launch',{stopOnEntry:true});await request('configurationDone');await stopped();
  const entry=await request('stackTrace',{threadId:1});assert.equal(entry.stackFrames[0].line,text.findIndex(x=>x.startsWith('START '))+1);
  if(argv.includes('--keyboard-console')){await breakpoint('KEYPRESS');await request('continue',{threadId:1});await key(65,65);await stopped();await breakpoint('CONSOLEPRESS');await request('continue',{threadId:1});await key(114);await stopped();console.log('KEYBOARD-CONSOLE PASS');await request('disconnect');return;}
  if(argv.includes('--console-only')){await breakpoint('CONSOLEPRESS');await request('continue',{threadId:1});await key(114);await stopped();console.log('CONSOLE-ONLY PASS',await backend.call('dap/evaluate',{expression:'LASTCONSOLE'}));await request('disconnect');return;}
  await breakpoint('REGTEST');await request('continue',{threadId:1});await stopped();
  const pc=(await backend.call('dap/state')).registers.PC;
  const native=await backend.call('dap/screen');assert.equal(native.source,'display-surface');
  assert.equal((await backend.call('dap/state')).registers.PC,pc);
  await request('setVariable',{variablesReference:1,name:'A',value:'$55'});
  await request('setExpression',{expression:'COUNTER',value:'$66'});
  const range=await request('evaluate',{expression:'BUFFER[16]'});
  await request('setVariable',{variablesReference:range.variablesReference,name:'[3]',value:'$99'});
  await request('next',{threadId:1});await stopped();
  assert.equal((await request('variables',{variablesReference:1})).variables.find(v=>v.name==='A').value,'$55');
  if(argv.includes('--no-data')){await request('next',{threadId:1});await stopped();}
  else {
  await breakpoint(null);
  let info=await request('dataBreakpointInfo',{variablesReference:2,name:'OBSERVED'});
  await request('setDataBreakpoints',{breakpoints:[{dataId:info.dataId,accessType:'write'}]});
  await request('continue',{threadId:1});assert.equal((await stopped()).body.reason,'data breakpoint');
  }
  assert((await request('evaluate',{expression:'OBSERVED'})).result.includes('$55'));
  const rows=await request('variables',{variablesReference:range.variablesReference});assert.equal(rows.variables[3].value,'$99');
  await request('setDataBreakpoints',{breakpoints:[]});await breakpoint('KEYPRESS');
  await request('continue',{threadId:1});await key(65,65);await stopped();
  assert(!(await request('evaluate',{expression:'LASTKEY'})).result.includes('$FF'));
  await breakpoint('CONSOLEPRESS');await request('continue',{threadId:1});await key(114);await stopped();
  assert((await request('evaluate',{expression:'LASTCONSOLE'})).result.includes('$05'));
  await request('continue',{threadId:1});await new Promise(r=>setTimeout(r,120));await key(114);await stopped();
  assert((await request('evaluate',{expression:'CONSOLECOUNT'})).result.includes('$02'));
  await breakpoint(null);await request('continue',{threadId:1});
  const first=await backend.call('dap/screen');await new Promise(r=>setTimeout(r,120));const second=await backend.call('dap/screen');
  assert(first.sequence!==second.sequence);assert(!(await backend.call('dap/state')).stopped);
  await request('pause',{threadId:1});await stopped();
  assert((await backend.call('dap/metrics')).samples.length>0);
  await request('disconnect');
  console.log('PASS standalone real Altirra: paths with spaces, XEX entry, breakpoints, step, edits, ranges, data breakpoint, display, keyboard, repeated Select presses, no VM service');
 } catch(error) {
  try {if(!(await backend.call('dap/state')).stopped){await backend.call('dap/resume',{mode:'pause'});await new Promise(r=>setTimeout(r,150));}
   console.error('Diagnostic state',await backend.call('dap/state'));
   for(const expression of ['COUNTER','CONSOLEBYTE','PREVCONSOLE','LASTCONSOLE','CONSOLECOUNT'])console.error(expression,await backend.call('dap/evaluate',{expression}));
  } catch(_) {}
  throw error;
 } finally {adapter.dispose();await backend.close();}
})().catch(error=>{console.error(error);console.error(logs.slice(-6000));process.exitCode=1;});
