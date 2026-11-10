import {build} from 'vite';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const base=resolve('.local/collection-removal-core'),out=resolve(base,'test-bundle');await mkdir(base,{recursive:true});
const report={cases:[],errors:[],external:[],status:'RUNNING',environment:'Chromium fresh context, loopback, synthetic records; metadata only'};let server,browser,context;
try{
 await build({configFile:false,logLevel:'error',build:{outDir:out,emptyOutDir:true,rolldownOptions:{input:resolve(base,'fixture.html')}}});
 server=createServer(async(req,res)=>{try{const path=resolve(out,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(out+'/'))throw Error('path');const data=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript'}[extname(path)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(report.external.push(r.request().url()),r.abort()));const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(origin+'/.local/collection-removal-core/fixture.html');await page.waitForFunction(()=>!!window.collectionRun);report.cases.push(await page.evaluate(()=>window.collectionRun()));report.status=report.errors.length||report.external.length?'FAIL':'PASS';
}catch(e){report.status='FAIL';report.error=String(e.stack||e);}finally{await context?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));await writeFile(resolve(base,'test-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;}
