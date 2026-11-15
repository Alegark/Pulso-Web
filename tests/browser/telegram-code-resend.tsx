/** TESTONLY UI fixture. SDK replaced by the browser harness; no real login. */
import React from 'react';import {createRoot} from 'react-dom/client';import {Activity} from '../../src/playback/ownership';import {TelegramPanel} from '../../src/ui/TelegramPanel';
const activity=new Activity();activity.open();let allowed=true;
const root=createRoot(document.getElementById('root')!);
const render=()=>root.render(<TelegramPanel activity={activity} canConnect={allowed} scopeKey="test-only-login" captureCurrent={()=>{const scope=activity.scope();return()=>allowed&&scope();}}/>);
Object.assign(globalThis,{codeResendUI:{deny(){allowed=false;activity.invalidate();render();}}});render();
