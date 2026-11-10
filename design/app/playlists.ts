export interface DemoPlaylist {id:string;name:string;description:string;trackIds:string[];color:'blue'|'orange'|'green';automatic?:boolean}
export const initialPlaylists:DemoPlaylist[]=[
  {id:'media-luz',name:'A media luz',description:'Para bajar el ritmo y quedarte un rato.',trackIds:['b','c','d'],color:'blue'},
  {id:'para-salir',name:'Para salir',description:'Canciones que te acompañan en el camino.',trackIds:['a','e','f'],color:'orange'},
];
