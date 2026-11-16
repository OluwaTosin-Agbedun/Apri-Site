#!/usr/bin/env node
import {readFile,writeFile,realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createSupersededCopy} from '../src/lib/superseded-pdf.ts'
const args=process.argv.slice(2)
const value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]}
const input=value('--input'),output=value('--output'),url=value('--current-url'),version=value('--version')
if(!input||!output||!url||!version){console.error('Use --input master.pdf --output superseded.pdf --current-url <Admin current-edition URL> --version <earlier label>. This never uploads or changes a master.');process.exit(2)}
try {
  if(resolve(input)===resolve(output))throw new Error('Input and output must be distinct; the original is never overwritten.')
  const source=await realpath(input)
  try{if(source===await realpath(output))throw new Error('The output points at the original master.')}catch(e){if(e.code!=='ENOENT')throw e}
  const result=await createSupersededCopy(await readFile(input),{currentUrl:url,version})
  await writeFile(output,result.bytes,{flag:'wx',mode:0o600})
  await writeFile(output+'.proof.json',JSON.stringify(result.proof,null,2)+'\n',{flag:'wx',mode:0o600})
  console.log('Created a separate superseded PDF and proof report. Inspect every page before uploading privately to Papermark. This is not a personalised watermark or a provider-delivery confirmation.')
}catch(e){console.error(e.message);process.exitCode=1}
