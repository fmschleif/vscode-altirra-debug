'use strict';
const assert=require('assert');const Module=require('module');const os=require('os');const path=require('path');
let provider,factory,terminated;const commands=new Map(),subscriptions=[],errors=[];
class Emitter{constructor(){this.event=()=>({dispose(){}});}fire(){}dispose(){}}
const noOp=()=>({dispose(){}});
const fake={EventEmitter:Emitter,window:{createOutputChannel:()=>({append(){},appendLine(){},show(){},dispose(){}}),showErrorMessage:m=>errors.push(m),activeTextEditor:{document:{uri:{fsPath:path.join(os.tmpdir(),'main.asm')}}}},
 workspace:{isTrusted:true,workspaceFolders:[{uri:{fsPath:os.tmpdir()}}],getConfiguration:()=>({get:(key,fallback)=>key==='altirraPath'?'Altirra64.exe':fallback}),registerTextDocumentContentProvider:noOp},
 commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return noOp();}},
 debug:{registerDebugConfigurationProvider:(type,p)=>{assert.equal(type,'altirra-debug');provider=p;return noOp();},registerDebugAdapterDescriptorFactory:(type,f)=>{factory=f;return noOp();},onDidTerminateDebugSession:fn=>{terminated=fn;return noOp();},onDidStartDebugSession:noOp},
 DebugAdapterInlineImplementation:class{constructor(adapter){this.implementation=adapter;}}};
const original=Module._load;Module._load=function(name,...args){return name==='vscode'?fake:original.call(this,name,...args);};
try{
 require('../src/extension').activate({extensionPath:path.resolve(__dirname,'..'),globalStorageUri:{fsPath:path.join(os.tmpdir(),'altirra-debug-mock-storage')},subscriptions});
 assert.equal(commands.size,8);
 const cfg=provider.resolveDebugConfiguration(fake.workspace.workspaceFolders[0],{source:'main.asm'});
 assert.equal(cfg.type,'altirra-debug');assert.equal(cfg.altirraPath,'Altirra64.exe');assert(cfg.storagePath);
 const session={id:'first',workspaceFolder:fake.workspace.workspaceFolders[0],configuration:cfg};
 factory.createDebugAdapterDescriptor(session);
 assert.throws(()=>factory.createDebugAdapterDescriptor({...session,id:'second'}),/Only one/);
 terminated(session);factory.createDebugAdapterDescriptor({...session,id:'second'});terminated({id:'second'});
 fake.workspace.isTrusted=false;assert.equal(provider.resolveDebugConfiguration(undefined,{}),undefined);assert(errors.length);
 console.log('PASS extension setup: independent debugger ID, settings, workspace trust, single-session guard and cleanup');
}finally{for(const d of subscriptions)d.dispose();Module._load=original;}
