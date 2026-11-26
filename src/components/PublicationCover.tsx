import Image from "next/image"
import type { PublicationCover as Cover } from "@/lib/publication-cover"

export default function PublicationCover({ cover, className = "w-24 shrink-0" }: { cover?: Cover | null; className?: string }) {
  if (!cover) return null
  return (
    <figure className={className} data-publication-cover>
      <Image src={cover.src} alt={cover.alt} width={160} height={220} unoptimized className="h-auto w-full object-contain" />
      {cover.credit && <figcaption className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{cover.credit}</figcaption>}
    </figure>
  )
}
