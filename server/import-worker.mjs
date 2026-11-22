import { parentPort, workerData } from 'node:worker_threads';
import { parseImport } from './import.mjs';
try{parentPort.postMessage({ok:true,...await parseImport({...workerData,bytes:Buffer.from(workerData.bytes)})});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
