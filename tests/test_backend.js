'use strict';
const assert=require('assert');
const path=require('path');
const {Backend}=require('../src/backend');
(async()=>{
 const backend=new Backend(path.resolve(__dirname,'..'),process.env.PYTHON||(process.platform==='win32'?'python':'python3'));
 try {
  await assert.rejects(backend.call('doctor',{altirraPath:'missing-altirra-debug-test'}),/Altirra not found/);
  await assert.rejects(backend.call('dap/state'),/No debug session/);
 } finally {await backend.close();}
 console.log('PASS backend process: correlated JSON errors, no HTTP service, graceful shutdown');
})().catch(e=>{console.error(e);process.exitCode=1;});
