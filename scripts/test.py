import os
from pathlib import Path
import subprocess
import sys
root=Path(__file__).resolve().parents[1]
env=dict(os.environ,PYTHONPATH=str(root/'backend'),PYTHON=sys.executable)
subprocess.run([sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py','-v'],cwd=root,env=env,check=True)
for test in sorted((root/'tests').glob('test_*.js')):
    subprocess.run(['node',str(test)],cwd=root,env=env,check=True)
