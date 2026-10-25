'use strict';
const fs=require('fs');
const path=require('path');
function validateFile(value) {
    try {return fs.statSync(value).isFile()?null:'Choose a file, not a folder';}
    catch(_){return 'File does not exist';}
}
async function configure(vscode,folder) {
    const scope=folder?.uri;
    const settings=vscode.workspace.getConfiguration('altirra-debug',scope);
    const target=folder?vscode.ConfigurationTarget.WorkspaceFolder:vscode.ConfigurationTarget.Global;
    const altirra=await vscode.window.showOpenDialog({title:'Select Altirra64.exe',canSelectMany:false,canSelectFolders:false,openLabel:'Use Altirra'});
    if(!altirra?.length)return false;
    const error=validateFile(altirra[0].fsPath);if(error)throw Error(error);
    const values={altirraPath:altirra[0].fsPath};
    const tools=[['atasmPath','ATasm executable path or command on PATH','atasm'],['pythonPath','Python 3.10+ executable path or command',process.platform==='win32'?'python':'python3']];
    if(process.platform!=='win32')tools.push(['winePath','Wine executable path or command','wine'],['winebootPath','wineboot executable path or command','wineboot']);
    for(const [key,prompt,fallback] of tools){
        const value=await vscode.window.showInputBox({title:'Altirra Debug setup',prompt,value:settings.get(key,'')||fallback,ignoreFocusOut:true,validateInput:v=>!v.trim()?'Enter an executable path or command':path.isAbsolute(v.trim())?validateFile(v.trim()):null});
        if(value===undefined)return false;
        values[key]=value.trim();
    }
    for(const [key,value] of Object.entries(values))await settings.update(key,value,target);
    return true;
}
async function warnConflict(vscode,context) {
    if(!vscode.extensions.getExtension('cerebus.atasm-altirra-bridge')||context.workspaceState.get('f5ConflictDismissed'))return;
    const choice=await vscode.window.showWarningMessage('Atasm Altirra Bridge may intercept F5. Use Run and Debug → Altirra, or disable that extension for this workspace.','Show Extension','Do Not Remind');
    if(choice==='Show Extension')await vscode.commands.executeCommand('extension.open','cerebus.atasm-altirra-bridge');
    if(choice==='Do Not Remind')await context.workspaceState.update('f5ConflictDismissed',true);
}
module.exports={configure,warnConflict,validateFile};
