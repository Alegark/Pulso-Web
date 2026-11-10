export const artists=[
  {id:'luna',name:'Luna Norte',initials:'LN',description:'Paisajes electrónicos, voces suaves y canciones para quedarse un rato.'},
  {id:'rio',name:'Río Claro',initials:'RC',description:'Guitarras cálidas y pequeños detalles cotidianos.'},
  {id:'casa',name:'Casa Azul',initials:'CA',description:'Ritmos tranquilos entre el soul y la electrónica.'},
];
export const albums=[
  {id:'orbita',title:'Órbita lenta',artistId:'luna',year:'2026',color:'blue',caption:'Sonidos que se quedan contigo.'},
  {id:'domingo',title:'Domingo sin prisa',artistId:'rio',year:'2025',color:'orange',caption:'Un espacio para bajar el ritmo.'},
  {id:'despues',title:'Después de la lluvia',artistId:'casa',year:'2026',color:'green',caption:'Para volver a empezar.'},
  {id:'cerca',title:'Un poco más cerca',artistId:'luna',year:'2024',color:'purple',caption:'Pequeñas cosas, nuevos lugares.'},
];
export interface DemoTrack {id:string;title:string;albumId:string;duration:string}
export const tracks:DemoTrack[]=[
  {id:'a',title:'Antes de salir',albumId:'orbita',duration:'3:42'},
  {id:'b',title:'Todo a su tiempo',albumId:'orbita',duration:'4:08'},
  {id:'c',title:'Luz de madrugada',albumId:'orbita',duration:'3:16'},
  {id:'d',title:'Sin mirar atrás',albumId:'orbita',duration:'3:54'},
  {id:'e',title:'La casa abierta',albumId:'domingo',duration:'2:58'},
  {id:'f',title:'Donde empieza el mar',albumId:'domingo',duration:'4:12'},
  {id:'g',title:'Volver despacio',albumId:'despues',duration:'3:25'},
  {id:'h',title:'A unos pasos',albumId:'cerca',duration:'3:09'},
];
export const albumFor=(track:DemoTrack)=>albums.find(a=>a.id===track.albumId)!;
export const artistFor=(album:typeof albums[number])=>artists.find(a=>a.id===album.artistId)!;
