/** Real PDF-byte notices. No network, no reader data, no master overwrite. */
import { createHash } from "node:crypto"
import {readFile} from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, rgb, degrees } from "pdf-lib"
export type SupersededProof = { format:"athena-superseded-v1"; sourceSha256:string; noticeSha256:string; pages:number; currentUrl:string; version:string }
const sha = (bytes:Uint8Array) => createHash("sha256").update(bytes).digest("hex")
export async function createSupersededCopy(input:Uint8Array,options:{currentUrl:string;version:string}):Promise<{bytes:Uint8Array;proof:SupersededProof}> {
  if(input.byteLength>100*1024*1024)throw new Error("PDF exceeds the 100 MB notice-processing limit.")
  const url=new URL(options.currentUrl)
  if(!['https://apri.athenacentre.org','https://athenaadvisory.ng'].includes(url.origin)||url.search||url.hash||url.username||url.password||!/^\/(?:portal\/publication|review\/library\/current)\/[a-f0-9-]{36}$/.test(url.pathname))throw new Error("Use the trusted, access-checked current-edition URL, without a token or query.")
  if(!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,59}$/.test(options.version))throw new Error("Use a short ASCII version label.")
  const doc=await PDFDocument.load(input,{updateMetadata:false})
  if(doc.catalog.has(PDFName.of('AthenaSuperseded')))throw new Error('This is already a notice copy. Start from the retained original master.')
  if(doc.isEncrypted)throw new Error("Use an authorised unencrypted master; encrypted PDFs are not rewritten.")
  // Editing a signature invalidates it; editable fields can place new content
  // over notices. Require a separately approved, flattened reading master.
  if(doc.catalog.get(PDFName.of('AcroForm'))||Buffer.from(input).includes(Buffer.from('/ByteRange')))throw new Error("Forms or signed PDFs need an approved flattened reading copy; the source was not changed.")
  const names=doc.catalog.lookupMaybe(PDFName.of('Names'),PDFDict)
  if(names?.has(PDFName.of('EmbeddedFiles'))||names?.has(PDFName.of('JavaScript'))||doc.catalog.has(PDFName.of('OpenAction')))throw new Error("Active content or embedded files require editorial inspection before processing.")
  const pages=doc.getPages()
  if(!pages.length||pages.length>2000)throw new Error("Use a PDF with 1–2000 pages.")
  doc.registerFontkit(fontkit)
  // Embed the licensed font in the NEW notice text so another device does
  // not substitute different metrics. Existing publication fonts stay intact.
  const font=await doc.embedFont(await readFile(new URL('../../assets/pdf-notice/LiberationSans-Regular.ttf',import.meta.url)),{subset:true})
  const bold=font
  const footerLabel=`SUPERSEDED - version ${options.version}. Current edition:`
  const wrap=(text:string,size:number,width:number)=>{
    const lines:string[]=[];let line=''
    for(const char of text){if(font.widthOfTextAtSize(line+char,size)>width){if(!line)throw new Error("The page is too narrow for a readable notice.");lines.push(line);line=''}line+=char}
    if(line)lines.push(line);return lines
  }
  for(const [index,page] of pages.entries()) {
    const old=page.getCropBox(),media=page.getMediaBox(),rotation=((page.getRotation().angle%360)+360)%360
    if(![0,90,180,270].includes(rotation)||![old.x,old.y,old.width,old.height].every(Number.isFinite))throw new Error("This PDF has unsupported page geometry; no notice copy was released.")
    const width=rotation%180?old.height:old.width
    if(width<180||Math.min(old.width,old.height)<100)throw new Error("This PDF is too small for a readable notice without obscuring its content.")
    const footer=[...wrap(footerLabel,8,width-24),...wrap(options.currentUrl,7.5,width-24)]
    const first=index===0?['SUPERSEDED PUBLICATION',...wrap(`This is version ${options.version}. Use the current edition at:`,10,width-24),...wrap(options.currentUrl,9,width-24)]:[]
    const bottom=footer.length*11+14,top=first.length?first.length*14+16:0
    const box={...old}
    if(rotation===0){box.y-=bottom;box.height+=bottom+top}
    if(rotation===90){box.x-=top;box.width+=bottom+top}
    if(rotation===180){box.y-=top;box.height+=bottom+top}
    if(rotation===270){box.x-=bottom;box.width+=bottom+top}
    // The original page object, text, links and annotations remain in place.
    // Clip its old content streams before expanding the crop, so material
    // hidden outside the former crop cannot become visible in the new bands.
    page.node.normalize()
    const contents=page.node.Contents()
    if(!(contents instanceof PDFArray))throw new Error("This PDF has unsupported content streams.")
    const ctx=doc.context
    contents.insert(0,ctx.register(ctx.flateStream(`q ${old.x} ${old.y} ${old.width} ${old.height} re W n\n`)))
    contents.push(ctx.register(ctx.flateStream('\nQ\n')))
    const x=Math.min(media.x,box.x),y=Math.min(media.y,box.y)
    page.setMediaBox(x,y,Math.max(media.x+media.width,box.x+box.width)-x,Math.max(media.y+media.height,box.y+box.height)-y)
    page.setCropBox(box.x,box.y,box.width,box.height)
    const visualHeight=rotation%180?box.width:box.height
    const point=(u:number,v:number)=>rotation===0?{x:box.x+u,y:box.y+v}:rotation===90?{x:box.x+box.width-v,y:box.y+u}:rotation===180?{x:box.x+box.width-u,y:box.y+box.height-v}:{x:box.x+v,y:box.y+box.height-u}
    const draw=(text:string,v:number,size:number,strong=false)=>page.drawText(text,{...point(12,v),font:strong?bold:font,size,color:rgb(.18,.18,.18),rotate:degrees(rotation)})
    footer.forEach((line,i)=>draw(line,bottom-13-i*11,i<wrap(footerLabel,8,width-24).length?8:7.5))
    first.forEach((line,i)=>draw(line,visualHeight-20-i*14,i===0?12:i===1?10:9,i===0))
    const addLink=(lo:number,hi:number)=>{
      const a=point(8,lo),b=point(width-8,hi)
      const link=ctx.register(ctx.obj({Type:'Annot',Subtype:'Link',Rect:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(options.currentUrl)}}))
      page.node.addAnnot(link)
    }
    // PDF strings must be encoded as strings, never PDF names.
    addLink(3,bottom-2)
    if(top)addLink(visualHeight-top+2,visualHeight-3)
  }
  doc.catalog.set(PDFName.of('AthenaSuperseded'),doc.context.obj({Version:PDFString.of(options.version),Current:PDFString.of(options.currentUrl),Source:PDFString.of(sha(input))}))
  const bytes=await doc.save({useObjectStreams:true})
  return {bytes,proof:{format:'athena-superseded-v1',sourceSha256:sha(input),noticeSha256:sha(bytes),pages:pages.length,currentUrl:options.currentUrl,version:options.version}}
}
