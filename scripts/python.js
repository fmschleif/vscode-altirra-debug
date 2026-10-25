'use strict';
const {spawnSync}=require('child_process');
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
const result=spawnSync(python,process.argv.slice(2),{stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exitCode=1;}else process.exitCode=result.status??1;
