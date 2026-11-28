import {validateAccountLibrary,LIBRARY_LIMITS,LibraryDocumentError,emptyLibrary} from '../../src/accounts/library-document.mjs';
import {BodyLimitError,readBoundedJson} from '../../src/accounts/bounded-body.mjs';
import {createAccountDataRouter} from './account-data.mjs';

export function createAccountLibraryRouter(options){
 return createAccountDataRouter({
  path:'/api/account-library',table:'pulso_account_library',column:'document',
  unavailableCode:'LIBRARY_UNAVAILABLE',conflictCode:'LIBRARY_CHANGED',
  inputMax:LIBRARY_LIMITS.bytes+1024,resultMax:LIBRARY_LIMITS.bytes+16384,
  parseInput(input){
   if(Object.keys(input).length!==3)throw Error('input');
   return {...input,document:validateAccountLibrary(input.document)};
  },
  values:input=>({document:input.document}),
  invalidInput(error){
   const code=error instanceof LibraryDocumentError?error.code:error instanceof BodyLimitError?'LIBRARY_TOO_LARGE':'LIBRARY_INVALID';
   return {code};
  },
  async onBadWrite(result,signal,respond){
   const pg=await readBoundedJson(result,16384,signal).catch(()=>null);
   if(pg?.code==='23514')return respond({code:'LIBRARY_TOO_LARGE'},400);
   if(['22P02','22P05','22021'].includes(pg?.code))return respond({code:'LIBRARY_INVALID'},400);
  },
  formatRow(row,subject,respond){
   let document;
   try{document=row?validateAccountLibrary(row.document):emptyLibrary();}
   catch(error){if(error instanceof LibraryDocumentError)return respond({code:'LIBRARY_UNRECOGNIZED'},422);throw error;}
   return respond({accountId:subject,revision:row?.revision??null,document});
  },
 },options);
}
export const accountLibrary=createAccountLibraryRouter();
