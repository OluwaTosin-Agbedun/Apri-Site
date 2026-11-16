import {notFound} from 'next/navigation'
import Link from 'next/link'
import {requireOwner} from '@/lib/dal'
import {publicationRecord} from '@/lib/publication-workflow'
import AdminShell from '@/components/AdminShell'
import PublicationWorkflowPanel from '@/components/PublicationWorkflowPanel'
export const dynamic='force-dynamic'
export default async function ReviewWorkflowPage({params}:{params:Promise<{id:string}>}){
  const admin=await requireOwner(),{id}=await params
  const record=await publicationRecord('review',id)
  if(!record)notFound()
  return <AdminShell admin={admin} current="/admin/review-library" title={String(record.title)}><Link href="/admin/review-library" className="text-sm underline">Back to Review Library</Link><PublicationWorkflowPanel kind="review" id={id} owner/></AdminShell>
}
