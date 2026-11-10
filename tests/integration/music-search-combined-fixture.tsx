import React from 'react';
import {createRoot} from 'react-dom/client';
import {MusicSearchController} from '../../src/ui/MusicSearchController';
createRoot(document.getElementById('root')!).render(<MusicSearchController visible scopeKey="fixture" client={null} phase="idle" bots={null} searchState={null} canConnect={false} tracks={[]}/>);
