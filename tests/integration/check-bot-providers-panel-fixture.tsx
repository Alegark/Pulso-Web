// Own synthetic presentation host. No Telegram identities or compatibility evidence.
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BotProvidersPanel, type BotProvidersPanelProps, type BotProviderRowView} from '../../src/ui/BotProvidersPanel';

const calls: unknown[][] = [];
let generation = 0;
let valid = true;
let props: BotProvidersPanelProps;
const root = createRoot(document.getElementById('root')!);
const capture = () => { const born = generation; return () => valid && born === generation; };
function render() {
  flushSync(() => root.render(<><BotProvidersPanel {...props} /><button id="outside">Otro control</button></>));
}
function reset() {
  generation++;
  valid = true;
  props = {rows: [], revision: 0, pending: false, canEdit: true, scopeKey: `scope-${generation}`, current: capture(), error: null,
    onAdd: value => calls.push(['add', value]),
    onMove: (id, direction) => calls.push(['move', id, direction]),
    onRemove: id => calls.push(['remove', id]), onCancel: () => calls.push(['cancel'])};
  calls.length = 0;
  render();
}
const host = {
  calls,
  reset,
  set(patch: Partial<BotProvidersPanelProps>) { props = {...props, ...patch}; render(); },
  rows(count: number): BotProviderRowView[] { return Array.from({length: count}, (_, i) => ({id: `id-${i}`, username: `fixture${i}bot`, label: `Bot ficticio ${i}`, profileStatus: 'unverified', compatibility: 'unverified'})); },
  seed(count: number) { props = {...props, rows: host.rows(count), revision: props.revision + 1}; render(); },
  confirmMove(id: string, direction: 'up' | 'down') {
    const rows = [...props.rows], index = rows.findIndex(row => row.id === id), to = index + (direction === 'up' ? -1 : 1);
    [rows[index], rows[to]] = [rows[to], rows[index]];
    host.set({rows, revision: props.revision + 1, pending: false});
  },
  confirmRemove(id: string) { host.set({rows: props.rows.filter(row => row.id !== id), revision: props.revision + 1, pending: false}); },
  invalidate() { generation++; valid = false; },
  fresh() { valid = true; props = {...props, current: capture()}; render(); },
  retireScope() { generation++; valid = true; props = {...props, scopeKey: `scope-${generation}`, current: capture()}; render(); },
  unmount() { flushSync(() => root.unmount()); },
};
Object.assign(window, {botPanelHost: host});
reset();
