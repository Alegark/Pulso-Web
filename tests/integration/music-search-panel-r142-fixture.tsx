import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MusicSearchPanel, type MusicSearchPanelProps} from '../../src/ui/MusicSearchPanel';
const root = createRoot(document.getElementById('root')!);
const calls: unknown[][] = [];
let epoch = 0;
let state: Partial<MusicSearchPanelProps> = {};
const defaults = (): MusicSearchPanelProps => ({
 query: '', suggestions: [], suggestionsPending: false, externalConsent: false,
 providerRows: [], selectedProviderId: null, sessionReady: false, canSearch: false,
 searchPending: false, botConsent: false, results: [], uncertain: false, selectedResultId: null,
 current: () => true,
 onQueryChange: value => {calls.push(['query', value]); state.query = value; render();},
 onExternalConsentChange: value => {calls.push(['external', value]);},
 onProviderChange: value => {calls.push(['provider', value]);},
 onBotConsentChange: value => {calls.push(['botConsent', value]);},
 onSearch: () => {calls.push(['search']);}, onChooseSuggestion: id => {calls.push(['suggestion', id]);},
 onCancel: () => {calls.push(['cancel']);}, onSelectResult: id => {calls.push(['result', id]);},
 onRetrySuggestions: () => {calls.push(['retry']);},
});
function render() {const captured = epoch; flushSync(() => root.render(<MusicSearchPanel {...defaults()} {...state} current={() => epoch === captured} />));}
Object.assign(window, {musicHost: {
 calls, set(patch: Partial<MusicSearchPanelProps>) {Object.assign(state, patch); render();},
 reset() {epoch++; state = {}; calls.length = 0; render();},
 clear() {calls.length = 0;}, revoke() {epoch++;}, fresh() {render();}, unmount() {flushSync(() => root.unmount());},
}});
render();
