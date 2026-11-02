export interface CheckedGunzip { (input:Uint8Array):Uint8Array;readonly terminal:boolean }
export function createCheckedGunzip(exports:WebAssembly.Exports):CheckedGunzip;
