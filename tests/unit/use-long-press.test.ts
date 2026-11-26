import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {useLongPress} from '../../src/ui/useLongPress';

test('long press fires once, suppresses click, and movement cancels',async()=>{
 let fired=0,handlers!:ReturnType<typeof useLongPress>;
 function Probe(){handlers=useLongPress({onLongPress:()=>{fired++;},delayMs:10});return null;}
 renderToString(React.createElement(Probe));
 const previous=globalThis.Element;
 class MockElement { closest(){return null;} }
 Object.assign(globalThis,{Element:MockElement});
 try {
  const pointer={isPrimary:true,pointerType:'touch',button:0,pointerId:1,clientX:0,clientY:0,target:new MockElement()} as unknown as React.PointerEvent<HTMLElement>;
  handlers.onPointerDown(pointer);handlers.onPointerMove({...pointer,clientX:11});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(fired,0);
  handlers.onPointerDown(pointer);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(fired,1);
  handlers.onPointerUp();let prevented=false,stopped=false;
  handlers.onClickCapture({preventDefault:()=>{prevented=true;},stopPropagation:()=>{stopped=true;}} as unknown as React.MouseEvent<HTMLElement>);
  assert.equal(prevented,true);assert.equal(stopped,true);
 } finally {Object.assign(globalThis,{Element:previous});}
});
