import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CollectionRemovalPanel,type CollectionRemovalPanelProps} from '../../src/ui/CollectionRemovalPanel';
const props:CollectionRemovalPanelProps={state:'uncertain',title:'Sintética',kind:'playlist',summary:null,accepted:false,onAccepted:()=>{},onConfirm:()=>{},onCancel:()=>{},onClose:()=>{},current:()=>true,result:{metadata:'committed',cleanup:'stopped',removed:0,skipped:0,freedBytes:null},message:null,canConfirm:false,canCancel:false,canClose:true};
test('an uncertain acknowledgement never displays a zero removal count',()=>{const html=renderToStaticMarkup(<CollectionRemovalPanel {...props}/>);assert.match(html,/No se puede confirmar el número total/);assert.doesNotMatch(html,/Copias retiradas: 0/);});
test('a settled result presents verified counts and the collection name',()=>{const html=renderToStaticMarkup(<CollectionRemovalPanel {...props} state="done" result={{metadata:'committed',cleanup:'complete',removed:2,skipped:1,freedBytes:1048576}}/>);assert.match(html,/Copias retiradas: 2/);assert.match(html,/MiB de audio retirados: 1/);assert.match(html,/Sintética/);});
