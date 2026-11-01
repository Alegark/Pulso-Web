#!/usr/bin/env python3
"""Project-pinned ODD snapshots via official Engram MCP; no cloud or global store."""
import argparse,base64,fcntl,hashlib,json,os,re,select,subprocess,time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
PROJECT='Pulso-Web'
DATA=ROOT/'.local/engram'
BINARY=ROOT/'.tools/engram/3.5.1/engram'
RECEIPT=DATA/'odd-receipts.json'
BEGIN='<PULSO_WEB_ODD_JSON_V1>\n'
END='\n</PULSO_WEB_ODD_JSON_V1>'
def sha(value):return hashlib.sha256(value).hexdigest()
def encode(value):return BEGIN+json.dumps(value,ensure_ascii=True,separators=(',',':'))+END

class Rpc:
 def __init__(self,readonly):
  env=dict(os.environ,ENGRAM_DATA_DIR=str(DATA),ENGRAM_PROJECT=PROJECT,ENGRAM_CLOUD_AUTOSYNC='0',ENGRAM_NO_UPDATE_CHECK='1')
  for key in list(env):
   if key.startswith('ENGRAM_CLOUD_') and key!='ENGRAM_CLOUD_AUTOSYNC':env.pop(key)
  self.log=open(DATA/'rpc-stderr.log','ab')
  allowed='mem_get_observation' if readonly else 'mem_save,mem_get_observation'
  self.p=subprocess.Popen([str(BINARY),'mcp','--tools='+allowed,'--project',PROJECT],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log)
  self.n=0;self.buffer=b''
  self.call('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'pulso-web-odd-sync','version':'1'}})
  self.p.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n');self.p.stdin.flush()
  names={t['name'] for t in self.call('tools/list',{})['tools']}
  assert set(allowed.split(','))<=names,'Required official MCP tools unavailable'
 def call(self,method,params):
  self.n+=1;request_id=self.n
  self.p.stdin.write((json.dumps({'jsonrpc':'2.0','id':request_id,'method':method,'params':params})+'\n').encode());self.p.stdin.flush()
  deadline=time.monotonic()+30
  while time.monotonic()<deadline:
   if b'\n' not in self.buffer:
    if not select.select([self.p.stdout],[],[],1)[0]:continue
    data=os.read(self.p.stdout.fileno(),65536)
    if not data:raise RuntimeError('Engram exited before answering')
    self.buffer+=data;continue
   line,self.buffer=self.buffer.split(b'\n',1)
   response=json.loads(line)
   if response.get('id')!=request_id:continue
   assert 'error' not in response,response.get('error')
   result=response['result'];assert not result.get('isError'),result
   return result
  raise TimeoutError('Engram MCP request timed out')
 def tool(self,name,args):
  result=self.call('tools/call',{'name':name,'arguments':args})
  return json.loads('\n'.join(item['text'] for item in result['content'] if item['type']=='text'))
 def save(self,topic,value):
  body=encode(value)
  assert len(body.encode())<30000,'Observation bound exceeded'
  result=self.tool('mem_save',{'title':topic,'content':body,'type':'config','project':PROJECT,'scope':'project','topic_key':topic,'capture_prompt':False})
  observation_id=int(result['id']);assert observation_id>0
  assert self.get(observation_id,topic)==value,'Immediate readback mismatch'
  return observation_id
 def get(self,observation_id,topic):
  value=self.tool('mem_get_observation',{'id':observation_id,'project':PROJECT})
  assert value['project'].casefold()==PROJECT.casefold(),'Wrong project envelope'
  text=value['result']
  assert re.match(r'^#'+str(observation_id)+r' \[config\] '+re.escape(topic)+r'\r?\n',text),'Wrong observation identity'
  assert re.search(r'\nProject: '+re.escape(PROJECT.casefold())+r'\r?\nScope: project\r?\nTopic: '+re.escape(topic)+r'\r?\n',text),'Wrong scope/topic'
  assert text.count(BEGIN)==1 and text.count(END)==1,'Missing or truncated payload'
  payload=json.loads(text.split(BEGIN,1)[1].split(END,1)[0])
  assert payload['project']==PROJECT,'Wrong payload project'
  return payload
 def close(self):
  self.p.stdin.close()
  try:self.p.wait(timeout=3)
  except subprocess.TimeoutExpired:self.p.terminate();self.p.wait(timeout=3)
  self.log.close()

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--read-only',action='store_true')
 args=parser.parse_args()
 assert json.loads((DATA/'config.json').read_text())['project_name']==PROJECT
 files=sorted((ROOT/'odd/tasks').glob('*.md'));assert files,'No canonical ODD tasks'
 snapshots={str(path.relative_to(ROOT)):path.read_bytes() for path in files}
 for content in snapshots.values():content.decode('utf-8',errors='strict')
 lock=open(DATA/'odd-sync.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
 receipts=json.loads(RECEIPT.read_text()) if RECEIPT.exists() else {}
 rpc=Rpc(args.read_only)
 results=[]
 try:
  for relative,content in snapshots.items():
   topic=('odd/'+relative.removeprefix('odd/tasks/').removesuffix('.md')).casefold()
   if args.read_only:
    record=receipts[relative]
    assert record['project']==PROJECT and record['topic']==topic and record['sha256']==sha(content),'Receipt/source mismatch'
    manifest=rpc.get(record['id'],topic)
   else:
    parts=[]
    for index,offset in enumerate(range(0,max(1,len(content)),12288)):
     chunk=content[offset:offset+12288]
     part_topic=topic+'/parts/'+sha(content)+'/'+str(index)
     part={'project':PROJECT,'file':relative,'index':index,'sha256':sha(chunk),'data':base64.b64encode(chunk).decode()}
     parts.append({'id':rpc.save(part_topic,part),'topic':part_topic,'index':index,'bytes':len(chunk),'sha256':sha(chunk)})
    assert (ROOT/relative).read_bytes()==content,'Canonical task changed during synchronization'
    manifest={'schema':1,'project':PROJECT,'file':relative,'sha256':sha(content),'bytes':len(content),'parts':parts}
    observation_id=rpc.save(topic,manifest)
    record={'project':PROJECT,'topic':topic,'sha256':sha(content),'id':observation_id}
   assert manifest['schema']==1 and manifest['file']==relative and manifest['project']==PROJECT
   assert manifest['sha256']==sha(content) and manifest['bytes']==len(content)
   reconstructed=b''
   for index,reference in enumerate(manifest['parts']):
    assert reference['index']==index
    part=rpc.get(reference['id'],reference['topic'])
    assert part['index']==index and part['file']==relative
    chunk=base64.b64decode(part['data'],validate=True)
    assert sha(chunk)==reference['sha256']==part['sha256'] and len(chunk)==reference['bytes']
    reconstructed+=chunk
   assert reconstructed==content and sha(reconstructed)==manifest['sha256'],'Full readback differs'
   assert rpc.get(record['id'],topic)==manifest,'Manifest changed during readback'
   assert (ROOT/relative).read_bytes()==content,'Source changed during readback'
   if not args.read_only:receipts[relative]=record
   results.append({'file':relative,'project':PROJECT,'bytes':len(content),'ContentSHA256':sha(content),'FullContentVerified':True})
  if not args.read_only:
   tmp=RECEIPT.with_suffix('.tmp');tmp.write_text(json.dumps(receipts,indent=2));tmp.chmod(0o600);tmp.replace(RECEIPT)
  print(json.dumps({'mode':'read-only' if args.read_only else 'sync','store':str(DATA),'tasks':results,'FullContentVerified':True},indent=2))
 finally:rpc.close();fcntl.flock(lock,fcntl.LOCK_UN);lock.close()

if __name__=='__main__':main()
