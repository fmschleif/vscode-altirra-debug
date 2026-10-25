const assert=require('assert');
const Module=require('module');
const vm=require('vm');
let handler,html,frame,custom,dispose,pending,failPost=false;const keyboardEvents=[];
const commands=new Map();
const panel={visible:true,webview:{
 set html(value){html=value;},
 onDidReceiveMessage(callback){handler=callback;},
 async postMessage(message){if(failPost)throw Error("disposed webview");frame=message;}
},onDidDispose(callback){dispose=callback;},dispose(){dispose();},reveal(){}};
const fake={
 ViewColumn:{Beside:2},
 commands:{registerCommand(name,fn){commands.set(name,fn);return {dispose(){}};}},
 window:{createWebviewPanel(type,title,placement,options){assert(placement.preserveFocus);assert.deepEqual(options.localResourceRoots,[]);return panel;},showErrorMessage(message){throw Error(message);}},
 debug:{onDidStartDebugSession(){return {dispose(){}};},activeDebugSession:{type:'altirra-debug',async customRequest(command,args){custom={command,args};}}}
};
const original=Module._load;Module._load=function(name,...args){return name==='vscode'?fake:original.call(this,name,...args);};
const context={subscriptions:[]};
(async()=>{
 try {
  require('../src/display').registerDisplay(context,async command=>{if(command==='dap/keyboard'){keyboardEvents.push(command);return {};}assert.equal(command,'dap/screen');if(pending)return await pending;return {available:true,sequence:'1792940000000000000',png:'FRAME',running:false};});
  commands.get('altirra-debug.display')();
  new vm.Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);
  assert(html.includes("default-src 'none'"));assert(html.includes('img-src data:'));
  await handler({action:'ready'});assert.equal(frame.type,'frame');assert.equal(frame.png,'FRAME');
  assert(html.includes("image.addEventListener('keydown'"));
  await handler({action:'keyboard',event:{action:'release'}});assert.equal(keyboardEvents.length,1);
  await handler({action:'stepIn'});assert.equal(custom.command,'stepIn');assert.equal(custom.args.threadId,1);
  await handler({action:'untrusted-command'});assert.equal(custom.command,'stepIn');
  failPost=true;await handler({action:'ready'});failPost=false;
  let resolve;pending=new Promise(done=>{resolve=done;});
  const refresh=handler({action:'ready'});
  panel.dispose();frame=undefined;
  resolve({available:true,sequence:'1792940000000000001',png:'STALE',running:false});
  await refresh;assert.equal(frame,undefined,'closed panel must not receive stale frames');
  console.log('PASS Atari display: preserve editor focus, restricted resources, frame messages and debug controls');
 } finally {
  for(const disposable of context.subscriptions)disposable.dispose();
  Module._load=original;
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
