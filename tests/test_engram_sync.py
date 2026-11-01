#!/usr/bin/env python3
"""Real MCP round trips against a disposable, isolated local Engram store."""
import base64,contextlib,importlib.util,io,json,sys,tempfile
from pathlib import Path

root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('pulso_odd_sync',root/'scripts/sync_odd_memory.py')
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
binary=sync.BINARY
def invoke(readonly=False):
 sys.argv=['sync_odd_memory.py']+(['--read-only'] if readonly else [])
 with contextlib.redirect_stdout(io.StringIO()) as output:sync.main()
 return json.loads(output.getvalue())
def rejected(label):
 try:invoke(True)
 except (AssertionError,KeyError,ValueError):print('PASS:',label);return
 raise AssertionError(label+' was accepted')

with tempfile.TemporaryDirectory(prefix='engram-validation-',dir=root/'.local') as tmp:
 sync.ROOT=Path(tmp);sync.DATA=sync.ROOT/'.local/engram';sync.DATA.mkdir(parents=True)
 sync.BINARY=binary;sync.RECEIPT=sync.DATA/'odd-receipts.json'
 for folder in [sync.ROOT/'.engram',sync.ROOT/'odd/tasks']:folder.mkdir(parents=True)
 for cfg in [sync.DATA/'config.json',sync.ROOT/'.engram/config.json']:cfg.write_text(json.dumps({'project_name':'Pulso-Web'}))
 task=sync.ROOT/'odd/tasks/roundtrip.md'
 original=('# Caso sintético, no datos reales\r\nÁrbol, música, € y Unicode: 🎵\r\n'*700).encode()
 task.write_bytes(original)
 assert invoke()['FullContentVerified'] and invoke(True)['FullContentVerified']
 receipt=json.loads(sync.RECEIPT.read_text());entry=receipt['odd/tasks/roundtrip.md']
 rpc=sync.Rpc(True)
 try:manifest=rpc.get(entry['id'],entry['topic'])
 finally:rpc.close()
 assert len(manifest['parts'])>1
 print('PASS: multi-part Unicode/CRLF full-content round trip')
 task.write_bytes(original+b'changed')
 rejected('read-only rejects changed canonical source');task.write_bytes(original)
 rpc=sync.Rpc(False)
 try:
  part=manifest['parts'][0];payload=rpc.get(part['id'],part['topic']);payload['data']=base64.b64encode(b'corrupted').decode()
  rpc.save(part['topic'],payload)
 finally:rpc.close()
 rejected('read-only rejects corrupted stored bytes')
 assert invoke()['FullContentVerified'] and invoke(True)['FullContentVerified']
 print('PASS: resync and independent verified recovery')
print('Disposable test store removed; production memory untouched')
