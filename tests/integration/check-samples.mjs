import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const access=JSON.parse(fs.readFileSync('.local/review/private-access.json','utf8'));
const auth=new URL(access.tokenUrl);auth.pathname='/samples.html';
const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'/usr/bin/chromium'});
try{
 const page=await browser.newPage();
 await page.goto(auth.href);
 await page.getByRole('heading',{name:'Aquí están las tres muestras'}).waitFor();
 const tracks=await page.locator('ol[aria-label="Tres muestras disponibles"] li h2').allTextContents();
 assert.deepEqual(tracks,['1. Aurora','2. Brisa','3. Camino']);
 const locks=await page.evaluate(()=>navigator.locks.query());
 const button=page.getByRole('button',{name:'Reproducir las tres'});
 console.log(JSON.stringify({stage:'loaded',tracks,locks,disabled:await button.isDisabled()}));
 await button.click({timeout:10000});
 await page.locator('[data-playback-state=playing]').waitFor({timeout:10000});
 console.log(JSON.stringify({stage:'playing',current:await page.locator('[aria-label="Reproductor de muestras"] h2').textContent()}));
 await page.locator('[data-playback-state=ended]').waitFor({timeout:60000});
 const final=await page.locator('[aria-label="Reproductor de muestras"] h2').textContent();assert.equal(final,'Camino');
 console.log(JSON.stringify({passed:true,final,tracks,environment:'Chromium desktop headless, real private HTTPS; no iPhone claim'}));
}finally{await browser.close();}
