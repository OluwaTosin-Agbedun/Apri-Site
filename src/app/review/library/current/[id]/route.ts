import {NextResponse} from 'next/server'
import {currentReviewReader} from '@/lib/review-reader'
import {getReviewLibraryForEmail} from '@/lib/publications'
import {publicationVersions,familyHistory,latestEntitledVersions} from '@/lib/publication-versions'
import {uuid} from '@/lib/publication-workflow-policy'
export const dynamic='force-dynamic'
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params
  const to=(path:string)=>NextResponse.redirect(new URL(path,request.url),{status:303,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}})
  const reader=await currentReviewReader()
  if(!reader)return to('/review/library/sign-in')
  if(!uuid.test(id))return to('/review/library?unavailable=1')
  const editions=await getReviewLibraryForEmail(reader.email)
  if(!editions.some(e=>e.id===id))return to('/review/library?unavailable=1')
  const versions=await publicationVersions('review',editions.map(e=>e.id))
  const latest=latestEntitledVersions(familyHistory(editions,e=>e.id,id,versions),e=>e.id,versions)[0]
  return to(latest?`/review/library/open/${latest.id}`:'/review/library?unavailable=1')
}
