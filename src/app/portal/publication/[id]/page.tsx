import {notFound,redirect} from 'next/navigation'
import Link from 'next/link'
import {requireSubscriber} from '@/lib/subscriber-dal'
import {loadSubscriberAccess,loadLegacyPublicationAccess} from '@/lib/access-policy-dal'
import {publicationVersions,familyHistory,latestEntitledVersions} from '@/lib/publication-versions'
import SiteHeader from '@/components/SiteHeader'
import PapermarkEmbed from '@/components/PapermarkEmbed'
import {papermarkEmbedUrl,papermarkShareUrl} from '@/lib/papermark-embed'
import {getDataRoomDocumentForSubscriber} from '@/lib/papermark-client-library'
export const dynamic='force-dynamic'
export const metadata={title:'Publication versions | APRI',robots:{index:false,follow:false}}
export default async function PublicationVersionPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{version?:string}>}){
  const reader=await requireSubscriber()
  if(!reader.hasAccess)redirect('/portal')
  const {id}=await params,{version}=await searchParams
  const access=await loadSubscriberAccess(reader.id)
  if(access.state!=='ok')return <main id="main-content" className="max-w-3xl mx-auto px-6 py-14"><h1 className="font-serif text-2xl">Library temporarily unavailable</h1><p className="mt-4">Your subscription has not changed. Please try again shortly.</p><Link href="/portal" className="underline inline-block mt-5">Back to your library</Link></main>
  let items:{id:string;title:string;href:string|null;rowId:string|null}[]=[]
  if(access.room)items=access.documents.filter(d=>d.publicationId&&d.decision.outcome==='allowed').map(d=>({id:d.publicationId!,title:d.editorialTitle||d.fileTitle,href:null,rowId:d.rowId}))
  else {
    const legacy=await loadLegacyPublicationAccess(reader.id)
    if(legacy.state!=='ok')redirect('/portal')
    items=legacy.items.filter(d=>d.decision.outcome==='allowed').map(d=>({id:d.publicationId,title:d.title,href:d.linkUrl,rowId:null}))
  }
  if(!items.some(i=>i.id===id))notFound()
  const versions=await publicationVersions('paid',items.map(i=>i.id))
  const history=familyHistory(items,i=>i.id,id,versions)
  const latest=latestEntitledVersions(history,i=>i.id,versions)[0]
  const chosen=version?history.find(i=>i.id===version):latest
  if(!chosen)notFound()
  const info=versions.get(chosen.id),older=Boolean(latest&&chosen.id!==latest.id)
  // No old raw original is handed out while the notice copy is unconfirmed.
  const ready=!older||Boolean(info?.noticeReady)
  const personal=ready&&chosen.rowId?await getDataRoomDocumentForSubscriber(reader.id,chosen.rowId):null
  const href=personal?.documentLinkUrl??chosen.href
  const embed=ready&&href?papermarkEmbedUrl(href,process.env.PAPERMARK_CUSTOM_DOMAIN):null
  const open=ready&&href?papermarkShareUrl(href,process.env.PAPERMARK_CUSTOM_DOMAIN):null
  return <div className="min-h-screen"><SiteHeader/><main id="main-content" tabIndex={-1} className="max-w-6xl mx-auto px-6 py-14"><Link href="/portal" className="underline text-sm">Back to your library</Link><h1 className="font-serif text-3xl mt-6">{chosen.title}</h1><p className="text-sm mt-3">{info?`Version ${info.label}. `:''}{older?'Superseded. The current permitted edition is linked below.':'Latest version available under your current access.'}</p>{embed?<div className="mt-6 h-[75dvh]"><PapermarkEmbed src={embed} title={chosen.title}/></div>:open?<a href={open} className="btn-primary mt-6" rel="noreferrer" target="_blank">Read this version</a>:<p role="status" className="my-6 text-sm">This protected reading copy is being prepared. Please try again shortly.</p>}{history.length>1&&<section className="mt-10"><h2 className="font-serif text-xl">Version history</h2><ul className="mt-4 space-y-3">{history.map(i=><li key={i.id}><Link className="underline text-sm" href={`/portal/publication/${id}?version=${i.id}`}>{i.title} · {versions.get(i.id)?.label??'Earlier version'}{i.id===latest?.id?' · Current permitted version':' · Superseded'}</Link></li>)}</ul></section>}</main></div>
}
