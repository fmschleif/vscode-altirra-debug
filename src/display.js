'use strict';
const vscode=require('vscode');
const crypto=require('crypto');

function registerDisplay(context,control) {
    let panel, timer, busy=false, lastSequence, lastRunning, lastImage;
    const fps=Math.max(1,Math.min(30,Number(vscode.workspace?.getConfiguration?.('altirra-debug')?.get('displayFps',20))||20));
    let auto=true;
    let keys=Promise.resolve();
    function keyboard(body) {keys=keys.catch(()=>{}).then(()=>control("dap/keyboard",body));return keys;}
    let epoch=0;
    async function post(target,message) {
        if(panel!==target)return;
        try {await target.webview.postMessage(message);} catch(_) { /* panel closed during delivery */ }
    }
    const html=()=>{
        const nonce=crypto.randomBytes(18).toString('base64');
        return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">
body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:10px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:5px 9px;cursor:pointer}button:focus{outline:1px solid var(--vscode-focusBorder)}
#screen:focus{outline:3px solid var(--vscode-focusBorder)}#screen{width:100%;height:auto;image-rendering:pixelated;background:#000}#screen.actual{width:auto;max-width:100%}#status{margin:10px 0;color:var(--vscode-descriptionForeground)}p{line-height:1.5}
</style></head><body><nav aria-label="Atari display controls">
<button data-action="continue">Continue</button><button data-action="pause">Pause</button>
<button data-action="stepIn">Step</button><button data-action="next">Step over</button>
<button id="keyboard">Keyboard: off</button><button data-console="115">Option</button><button data-console="114">Select</button><button data-console="113">Start</button>
<button id="auto">Auto refresh: on</button><button id="size">Original size</button><button data-action="save">Save PNG</button>
</nav><img id="screen" tabindex="0" aria-label="Atari display keyboard input" alt="Atari framebuffer; waiting for first frame"><div id="status" role="status">Waiting for the debug emulator…</div>
<p>Click the image to type into the Atari without switching windows. F5/F10/F11 remain debugger controls. Keyboard input needs a running CPU. Images use the native display surface while running and paused; minimizing the emulator freezes the last available image.</p>
<script nonce="${nonce}">
const api=acquireVsCodeApi();const image=document.getElementById('screen');const status=document.getElementById('status');
window.addEventListener('message',event=>{const m=event.data;if(m.type==='reset'){image.removeAttribute('src');status.textContent='Starting the debug emulator…';}else if(m.type==='frame'){image.src='data:image/png;base64,'+m.png;status.textContent='Frame '+m.time+' — '+(m.source==='cached-display'?'cached image; window unavailable':m.running?'running':(m.source==='display-surface'?'paused; current display':'paused; last completed frame (fallback)'));}else if(m.type==='status'){status.textContent=m.text;}});
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>api.postMessage({action:button.dataset.action})));
document.getElementById('auto').addEventListener('click',event=>{const on=event.target.textContent.endsWith('off');event.target.textContent='Auto refresh: '+(on?'on':'off');api.postMessage({action:'auto',enabled:on});});
document.getElementById('size').addEventListener('click',event=>{image.classList.toggle('actual');event.target.textContent=image.classList.contains('actual')?'Fit width':'Original size';});
let keyboardOn=false;
const keyButton=document.getElementById('keyboard');
function release(){api.postMessage({action:'keyboard',event:{action:'release'}});}
function enable(on){keyboardOn=on;keyButton.textContent='Keyboard: '+(on?'on':'off');if(on)image.focus();else release();}
keyButton.addEventListener('click',()=>enable(!keyboardOn));
image.addEventListener('click',()=>enable(true));image.addEventListener('blur',release);window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
const special={Enter:13,Escape:27,Backspace:8,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Delete:46,Insert:45,Home:36,End:35,Shift:16,Control:17,F2:113,F3:114,F4:115};
function eventKey(e,down){
 if(!keyboardOn)return;
 let vk=special[e.key],char=0;
 if(vk===undefined && e.key.length===1){char=e.key.charCodeAt(0);if(e.code.startsWith('Key'))vk=e.code.charCodeAt(3);else if(e.code.startsWith('Digit'))vk=e.code.charCodeAt(5);else vk=e.key===' '?32:char<128?char:0;}
 if(!vk || e.altKey || e.metaKey)return;
 e.preventDefault();e.stopPropagation();
 if(e.repeat)return;
 api.postMessage({action:'keyboard',event:{action:'key',vk,char,down}});
}
image.addEventListener('keydown',e=>eventKey(e,true));image.addEventListener('keyup',e=>eventKey(e,false));
document.querySelectorAll('[data-console]').forEach(button=>button.addEventListener('click',()=>{const vk=Number(button.dataset.console);api.postMessage({action:'keyboard',event:{action:'key',vk,down:true}});setTimeout(()=>api.postMessage({action:'keyboard',event:{action:'key',vk,down:false}}),150);}));
api.postMessage({action:'ready'});
</script></body></html>`;
    };
    async function refresh() {
        if(!panel||!panel.visible||busy||!auto)return;
        busy=true;
        const target=panel, generation=epoch;
        try {
            const frame=await control('dap/screen');
            if(panel!==target || epoch!==generation)return;
            if(frame.available&&(frame.sequence!==lastSequence || frame.running!==lastRunning)) {
                lastSequence=frame.sequence;lastRunning=frame.running;lastImage=frame.png;
                await post(target,{type:'frame',png:frame.png,running:frame.running,source:frame.source,
                    time:new Date(Number(BigInt(frame.sequence)/1000000n)).toLocaleTimeString()});
            } else if(!frame.available)await post(target,{type:'status',text:'Waiting for the first framebuffer…'});
        } catch(_) {
            if(panel===target && epoch===generation)await post(target,{type:'status',text:vscode.debug.activeDebugSession&&vscode.debug.activeDebugSession.type==='altirra-debug'?'Starting the debug emulator — waiting for its first frame…':'No debug framebuffer available. Start Altirra Debug with F5.'});
        } finally {busy=false;}
    }
    function open() {
        if(panel){panel.reveal(vscode.ViewColumn.Beside,true);return;}
        lastSequence=undefined;lastImage=undefined;auto=true;
        panel=vscode.window.createWebviewPanel('altirra-debug.display','Atari Display',
            {viewColumn:vscode.ViewColumn.Beside,preserveFocus:true},
            {enableScripts:true,localResourceRoots:[],retainContextWhenHidden:true});
        panel.webview.html=html();
        panel.onDidDispose(()=>{epoch++;clearInterval(timer);panel=undefined;void keyboard({action:"release"}).catch(()=>{});});
        panel.webview.onDidReceiveMessage(async message=>{
            try {
                if(!message||typeof message.action!=='string')return;
                if(message.action==='keyboard'){await keyboard(message.event||{});}
                else if(message.action==='ready'){lastSequence=undefined;await refresh();}
                else if(message.action==='auto'){auto=message.enabled===true;if(auto)await refresh();}
                else if(message.action==='save'&&lastImage){
                    const uri=await vscode.window.showSaveDialog({filters:{'PNG image':['png']},saveLabel:'Save Atari Frame'});
                    if(uri)await vscode.workspace.fs.writeFile(uri,Buffer.from(lastImage,'base64'));
                } else if(['continue','pause','stepIn','next'].includes(message.action)) {
                    const session=vscode.debug.activeDebugSession;
                    if(!session||session.type!=='altirra-debug')throw Error('Start an Altirra Debug debug session first');
                    await session.customRequest(message.action,{threadId:1});
                }
            } catch(error){vscode.window.showErrorMessage('Atari Display: '+error.message);}
        });
        timer=setInterval(()=>{void refresh().catch(()=>{});},Math.round(1000/fps));
    }
    context.subscriptions.push(vscode.commands.registerCommand('altirra-debug.display',open),
        vscode.debug.onDidStartDebugSession(session=>{if(session.type==='altirra-debug'){epoch++;lastSequence=undefined;lastRunning=undefined;open();void post(panel,{type:'reset'});}}),
        {dispose:()=>{clearInterval(timer);if(panel)panel.dispose();}});
}
module.exports={registerDisplay};
