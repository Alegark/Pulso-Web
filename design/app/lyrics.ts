export interface DemoLyricLine {text:string;time?:number}
export interface DemoLyrics {kind:'timed'|'plain'|'missing';lines:DemoLyricLine[]}
/** Original writing for this UI fixture. No lyrics/provider from a real artist. */
export const demoLyrics:Record<string,DemoLyrics>={
  a:{kind:'timed',lines:[
    {time:0,text:'Guardo un poco de luz antes de salir.'},
    {time:2,text:'La ciudad despierta y yo camino aquí.'},
    {time:4,text:'Cada esquina abre un lugar para volver.'},
    {time:6,text:'Voy despacio, queda tanto por ver.'},
  ]},
  b:{kind:'plain',lines:[
    {text:'Hay un reloj dormido junto al ventanal.'},
    {text:'Y una tarde entera para caminar.'},
    {text:'Lo pequeño encuentra su lugar aquí.'},
    {text:'Todo tiene tiempo cuando estás así.'},
  ]},
};
export const missingLyrics:DemoLyrics={kind:'missing',lines:[]};
