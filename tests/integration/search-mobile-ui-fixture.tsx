import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MusicSearchPanel,type MusicSearchPanelProps} from '../../src/ui/MusicSearchPanel';
import '../../src/ui/shell.css';
import '../../src/style.css';
import '../../src/ui/design-tokens.css';
import '../../src/ui/responsive-shell.css';
import '../../src/ui/design-fidelity.css';

const root=createRoot(document.getElementById('root')!);
const calls:unknown[][]=[];
let epoch=0,patch:Partial<MusicSearchPanelProps>={},visible=true;
const rows:MusicSearchPanelProps['suggestions']=[
 {id:'track',kind:'track',title:'Antes de salir',subtitle:'Luna Norte · Órbita lenta',source:'lrclib'},
 {id:'album',kind:'album',title:'Órbita lenta',subtitle:'Luna Norte',source:'itunes'},
 {id:'artist',kind:'artist',title:'Luna Norte',subtitle:null,source:'itunes'},
];
function render(){
 const captured=epoch;
 const props:MusicSearchPanelProps={query:'',suggestions:[],suggestionsPending:false,resultsVisible:false,selectedSuggestionId:null,primaryProvider:null,sessionReady:false,canSearch:false,searchPending:false,results:[],uncertain:false,selectedResultId:null,
  onQueryChange:value=>{calls.push(['query',value]);patch.query=value;patch.suggestions=value.trim()?rows:[];render();},
  onSearch:()=>{calls.push(['search']);},onChooseSuggestion:(id,opener)=>{calls.push(['choose',id,opener.dataset.suggestionId]);},onCancel:()=>{calls.push(['cancel-operation']);},onSelectResult:id=>{calls.push(['result',id]);},onRetrySuggestions:()=>{calls.push(['retry']);},
  ...patch,current:()=>captured===epoch,
 };
 flushSync(()=>root.render(<main className="pulso-app"><header className="pulso-header"><p className="pulso-wordmark">pulso</p><nav className="shell-nav" aria-label="Principal"><button>Inicio</button><button aria-current="page">Buscar</button><button>Biblioteca</button></nav><button>Configuración</button></header><div aria-label="Buscador musical" hidden={!visible}><div className="fixture-search-parent"><MusicSearchPanel key={epoch} {...props}/></div></div><p hidden={visible}>Otra pantalla</p></main>));
}
Object.assign(window,{searchUI:{calls,rows,set:(next:Partial<MusicSearchPanelProps>)=>{Object.assign(patch,next);render();},clear:()=>{calls.length=0;},reset:()=>{epoch++;patch={};visible=true;calls.length=0;render();},revoke:()=>{epoch++;},show:(next:boolean)=>{visible=next;render();}}});
render();
