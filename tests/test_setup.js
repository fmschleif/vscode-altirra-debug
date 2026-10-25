'use strict';
const assert=require('assert'),os=require('os'),fs=require('fs'),path=require('path');
const {configure,warnConflict,validateFile}=require('../src/setup');
(async()=>{
 const manifest=require('../package.json');
 for(const key of ['altirraPath','atasmPath','pythonPath','winePath','winebootPath'])assert.equal(manifest.contributes.configuration.properties['altirra-debug.'+key].scope,'resource');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'altirra setup '));
 try {
 const file=path.join(dir,'Altirra64.exe');fs.writeFileSync(file,'test');
 assert.equal(validateFile(file),null);assert(validateFile(dir));assert(validateFile(file+'missing'));
 const writes=[],values={};let picked=[{fsPath:file}],cancel=false;
 const folder={uri:{fsPath:dir}};
 const vscode={ConfigurationTarget:{WorkspaceFolder:3,Global:1},workspace:{getConfiguration:(name,scope)=>{assert.equal(scope,folder.uri);return {get:(k,d)=>d,update:async(k,v,target)=>writes.push([k,v,target])};}},window:{showOpenDialog:async()=>picked,showInputBox:async o=>cancel?undefined:o.value},extensions:{getExtension:()=>({})},commands:{executeCommand:async()=>{}}};
 assert(await configure(vscode,folder));assert.equal(writes[0][1],file);assert(writes.every(w=>w[2]===3));
 writes.length=0;cancel=true;assert.equal(await configure(vscode,folder),false);assert.equal(writes.length,0);
 picked=undefined;assert.equal(await configure(vscode,folder),false);
 let warnings=0;vscode.window.showWarningMessage=async()=>{warnings++;return 'Do Not Remind';};
 const context={workspaceState:{get:k=>values[k],update:async(k,v)=>values[k]=v}};
 await warnConflict(vscode,context);await warnConflict(vscode,context);assert.equal(warnings,1);
 console.log('PASS setup: file validation, scoped settings, cancellation, conflict warning dismissal');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
