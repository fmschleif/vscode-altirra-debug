'use strict';
const vscode=require('vscode');
const fs=require('fs');
const path=require('path');
const {Backend}=require('./backend');
const {Adapter}=require('./adapter');
const {registerDisplay}=require('./display');

function activate(context) {
    const output=vscode.window.createOutputChannel('Altirra Debug');
    let current;
    const changed=new vscode.EventEmitter(),views=new Map();
    function settings() {return vscode.workspace.getConfiguration('altirra-debug');}
    function defaults(folder,config={}) {
        const s=settings();
        return {...config,cwd:config.cwd||folder?.uri.fsPath||vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            altirraPath:config.altirraPath||s.get('altirraPath',''),atasmPath:config.atasmPath||s.get('atasmPath','atasm'),
            pythonPath:config.pythonPath||(s.get('pythonPath','')||(process.platform==='win32'?'python':'python3')),
            winePath:config.winePath||s.get('winePath','wine'),winebootPath:config.winebootPath||s.get('winebootPath','wineboot'),
            storagePath:context.globalStorageUri.fsPath};
    }
    async function call(command,body={}) {
        if(!current)throw Error('Start an Altirra Debug session first');
        return current.backend.call(command,body);
    }
    const provider={
        resolveDebugConfiguration(folder,config) {
            if(!vscode.workspace.isTrusted){vscode.window.showErrorMessage('Trust this workspace before building and debugging.');return;}
            const result=defaults(folder,config);
            result.type='altirra-debug';result.request='launch';result.name=result.name||'Altirra: Debug ATasm';
            if(!result.source&&!result.program)result.source=vscode.window.activeTextEditor?.document.uri.fsPath;
            if(!result.source&&!result.program){vscode.window.showErrorMessage('Set source or program in launch.json.');return;}
            if(!result.altirraPath){vscode.window.showErrorMessage('Set altirra-debug.altirraPath to Altirra64.exe in Settings.');return;}
            return result;
        }
    };
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('altirra-debug',provider));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('altirra-debug',{
        createDebugAdapterDescriptor(session) {
            if(current)throw Error('Only one Altirra Debug session may run in this window. Stop it before starting another.');
            const cfg=defaults(session.workspaceFolder,session.configuration);
            const backend=new Backend(context.extensionPath,cfg.pythonPath,text=>output.append(text));
            const adapter=new Adapter((command,body)=>backend.call(command,command==='launch'?{...cfg,...body}:body),()=>cfg.cwd);
            current={id:session.id,backend,adapter};
            adapter.onDidSendMessage(message=>{
                if(message.event==='stopped')for(const uri of views.keys())changed.fire(vscode.Uri.parse(uri));
            });
            return new vscode.DebugAdapterInlineImplementation(adapter);
        }
    }));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session=>{
        if(session.id!==current?.id)return;
        const owned=current;current=undefined;owned.adapter.dispose();void owned.backend.close();
    }));
    function register(name,fn){context.subscriptions.push(vscode.commands.registerCommand('altirra-debug.'+name,async()=>{
        try {if(!vscode.workspace.isTrusted)throw Error('Workspace trust is required');await fn();}
        catch(error){vscode.window.showErrorMessage('Altirra Debug: '+error.message);}
    }));}
    async function memory() {
        const editor=vscode.window.activeTextEditor;
        const known=editor&&views.get(editor.document.uri.toString());if(known)return known;
        const address=await vscode.window.showInputBox({prompt:'RAM label/address, e.g. COUNTER, VALUE+5, $6000'});if(!address)return;
        const length=await vscode.window.showInputBox({prompt:'Byte count, 1..4096',value:'64',validateInput:v=>/^\d+$/.test(v)&&Number(v)>=1&&Number(v)<=4096?null:'Use 1..4096'});
        if(!length)return;return {address,length:Number(length)};
    }
    function dump(result,address) {
        const bytes=Buffer.from(result.data,'base64');let text=`CPU RAM at ${address} (${result.address}) — paused snapshot; edits apply on resume\n\n`;
        for(let i=0;i<bytes.length;i+=16){const row=bytes.subarray(i,i+16);text+=(parseInt(result.address,16)+i).toString(16).toUpperCase().padStart(4,'0')+'  '+[...row].map(x=>x.toString(16).toUpperCase().padStart(2,'0')).join(' ').padEnd(47)+'  '+[...row].map(x=>x>=32&&x<127?String.fromCharCode(x):'.').join('')+'\n';}
        return text;
    }
    context.subscriptions.push(changed,output,vscode.workspace.registerTextDocumentContentProvider('altirra-memory',{
        onDidChange:changed.event,async provideTextDocumentContent(uri){try{const m=views.get(uri.toString());return dump(await call('dap/read',{address:m.address,count:m.length}),m.address);}catch(error){return 'Memory unavailable: '+error.message;}}
    }));
    register('debug',async()=>{
        if(current){await vscode.debug.activeDebugSession?.customRequest('continue',{threadId:1});return;}
        await vscode.workspace.saveAll();
        const editor=vscode.window.activeTextEditor;
        if(!editor)throw Error('Open an assembly entry file first');
        const folder=vscode.workspace.getWorkspaceFolder(editor.document.uri);
        await vscode.debug.startDebugging(folder,{type:'altirra-debug',request:'launch',name:'Altirra: Debug active file',source:editor.document.uri.fsPath,stopOnEntry:true});
    });
    register('inspect',async()=>{const m=await memory();if(!m)return;const uri=vscode.Uri.from({scheme:'altirra-memory',path:'/'+encodeURIComponent(m.address)+'.txt',query:String(m.length)});views.set(uri.toString(),m);await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri),{preview:false});});
    register('refresh',async()=>{for(const uri of views.keys())changed.fire(vscode.Uri.parse(uri));});
    register('export',async()=>{const m=await memory();if(!m)return;const r=await call('dap/read',{address:m.address,count:m.length});await vscode.env.clipboard.writeText([...Buffer.from(r.data,'base64')].map(x=>x.toString(16).toUpperCase().padStart(2,'0')).join(' '));});
    register('edit',async()=>{const m=await memory();if(!m)return;const hex=await vscode.window.showInputBox({prompt:'RAM bytes in hex; staged until next step/Continue',validateInput:v=>/^(?:[\da-fA-F]{2}\s*){1,4096}$/.test(v.trim())?null:'Use pairs such as 2A 00 FF'});if(!hex)return;await call('dap/write',{address:m.address,data:Buffer.from(hex.replace(/\s/g,''),'hex').toString('base64')});current.adapter.editing.edited();for(const uri of views.keys())changed.fire(vscode.Uri.parse(uri));});
    register('dataBreakpoint',async()=>{if(!current)throw Error('Start debugging first');await vscode.commands.executeCommand('workbench.debug.viewlet.action.addDataBreakpointOnAddress');});
    register('doctor',async()=>{const cfg=defaults(vscode.workspace.workspaceFolders?.[0]);const backend=new Backend(context.extensionPath,cfg.pythonPath,text=>output.append(text));try{const report=await backend.call('doctor',cfg);output.appendLine(JSON.stringify(report,null,2));output.show(true);}finally{await backend.close();}});
    registerDisplay(context,call);
    context.subscriptions.push({dispose:()=>{if(current){current.adapter.dispose();void current.backend.close();current=undefined;}}});
}
module.exports={activate};
