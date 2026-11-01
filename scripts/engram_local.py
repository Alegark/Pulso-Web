#!/usr/bin/env python3
import os
from pathlib import Path
root=Path(__file__).resolve().parent.parent
env=dict(os.environ)
for key in list(env):
 if key.startswith('ENGRAM_CLOUD_'):env.pop(key)
env.update(ENGRAM_DATA_DIR=str(root/'.local/engram'),ENGRAM_PROJECT='Pulso-Web',ENGRAM_CLOUD_AUTOSYNC='0',ENGRAM_NO_UPDATE_CHECK='1')
os.chdir(root)
binary=root/'.tools/engram/3.5.1/engram'
os.execve(binary,[str(binary),'mcp','--project','Pulso-Web'],env)
