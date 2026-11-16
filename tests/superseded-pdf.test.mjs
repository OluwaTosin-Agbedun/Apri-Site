import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {PDFDocument,PDFName,PDFString,PDFDict,PDFRawStream,decodePDFRawStream,StandardFonts,degrees} from 'pdf-lib'
import {createSupersededCopy} from '../src/lib/superseded-pdf.ts'
const options={currentUrl:'https://athenaadvisory.ng/portal/publication/11111111-1111-4111-8111-111111111111',version:'1.0'}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function embeddedText(doc,page,streams){
  const fonts=page.node.Resources().lookup(PDFName.of('Font'),PDFDict)
  const maps=new Map();let embedded=false
  for(const [name,ref]of fonts.entries()){
    const f=doc.context.lookup(ref,PDFDict),toUnicode=f.lookupMaybe(PDFName.of('ToUnicode'),PDFRawStream)
    if(!toUnicode)continue
    const cmap=Buffer.from(decodePDFRawStream(toUnicode).decode()).toString(),map=new Map()
    for(const pair of cmap.matchAll(/<([0-9a-f]+)>\s+<([0-9a-f]+)>/gi))map.set(pair[1].toUpperCase(),Buffer.from(pair[2],'hex').swap16().toString('utf16le'))
    maps.set(name.toString().slice(1),map)
    const descendants=f.lookup(PDFName.of('DescendantFonts'))
    const descendant=doc.context.lookup(descendants.get(0),PDFDict),descriptor=descendant.lookup(PDFName.of('FontDescriptor'),PDFDict)
    embedded ||= descriptor.has(PDFName.of('FontFile2'))
  }
  assert.equal(embedded,true,'the new notice font is embedded, not a device-dependent overlay/substitution')
  const lines=[];let current=null
  for(const stream of streams)for(const line of stream.split('\n')){
    const font=/\/([^\s]+)\s+[\d.]+\s+Tf/.exec(line);if(font)current=maps.get(font[1])
    const text=/<([0-9a-f]+)>\s+Tj/i.exec(line)
    if(text&&current)lines.push((text[1].match(/.{4}/g)??[]).map(c=>current.get(c.toUpperCase())??'').join(''))
  }
  return lines.join('\n')
}
async function source({form=false}={}){
  const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica)
  for(const rotation of [0,90,180,270]){
    const p=doc.addPage([612,792]);p.setCropBox(30,40,550,700);p.setRotation(degrees(rotation))
    p.drawText(`ORIGINAL BODY PAGE ${rotation}`,{x:70,y:200,size:12,font})
    p.drawText('HIDDEN OUTSIDE THE CROP',{x:0,y:5,size:5,font})
    p.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[70,190,200,220],Border:[0,0,0],A:{S:'URI',URI:PDFString.of('https://example.invalid/original-reference')}})))
  }
  doc.catalog.set(PDFName.of('Lang'),PDFString.of('en-NG'))
  if(form)doc.getForm().createTextField('editable').addToPage(doc.getPages()[0])
  return doc.save()
}
test('notices are embedded in PDF bytes on the first page and every footer; all four rotations, crop and original content remain intact',async()=>{
  const input=await source(),before=hash(input),result=await createSupersededCopy(input,options)
  assert.equal(hash(input),before);assert.equal(result.proof.sourceSha256,before);assert.equal(result.proof.noticeSha256,hash(result.bytes));assert.notEqual(result.proof.noticeSha256,before)
  assert.equal(result.proof.pages,4);assert.equal(result.proof.currentUrl,options.currentUrl)
  const doc=await PDFDocument.load(result.bytes),original=await PDFDocument.load(input)
  assert.equal(doc.getPages().length,original.getPages().length)
  assert.equal(doc.catalog.lookup(PDFName.of('Lang')).decodeText(),'en-NG')
  for(const [i,p] of doc.getPages().entries()){
    const old=original.getPages()[i];assert.equal(p.getRotation().angle,old.getRotation().angle)
    assert.ok(p.getCropBox().width>=old.getCropBox().width);assert.ok(p.getCropBox().height>=old.getCropBox().height)
    const streams=p.node.Contents().asArray().map(ref=>doc.context.lookup(ref)).filter(s=>s instanceof PDFRawStream).map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString())
    assert.match(streams[0],/^q 30 40 550 700 re W n/,'the expanded crop does not reveal hidden original content')
    const content=streams.join('\n')
    assert.ok(content.includes(Buffer.from(`ORIGINAL BODY PAGE ${[0,90,180,270][i]}`).toString('hex').toUpperCase()))
    const noticeText=embeddedText(doc,p,streams)
    assert.match(noticeText,/SUPERSEDED - version/,'every page has the embedded footer')
    assert.equal(noticeText.includes('SUPERSEDED PUBLICATION'),i===0,'only the first page has the prominent notice')
    const links=p.node.Annots().asArray().map(ref=>doc.context.lookup(ref,PDFDict).lookup(PDFName.of('A'),PDFDict).lookup(PDFName.of('URI')).decodeText())
    assert.ok(links.includes('https://example.invalid/original-reference'),'original reference annotation retained')
    assert.ok(links.includes(options.currentUrl),'footer links to the first-party access-checked current route')
  }
  await assert.rejects(createSupersededCopy(result.bytes,options),/already a notice copy/i)
})
test('processing refuses forms, bad destinations, invalid input and unreadably small pages',async()=>{
  await assert.rejects(createSupersededCopy(await source({form:true}),options),/Forms or signed/)
  for(const currentUrl of ['https://attacker.invalid/portal/publication/11111111-1111-4111-8111-111111111111',options.currentUrl+'?token=private','http://athenaadvisory.ng/portal/publication/11111111-1111-4111-8111-111111111111'])await assert.rejects(createSupersededCopy(await source(),{...options,currentUrl}),/trusted/)
  await assert.rejects(createSupersededCopy(new Uint8Array([1,2,3]),options))
  const tiny=await PDFDocument.create();tiny.addPage([60,80]);await assert.rejects(createSupersededCopy(await tiny.save(),options),/too small/)
})
