export type KnownLink={ownerId:string;kind:"document"|"room";documentId?:string}
export function linksToRevoke(subscriberId:string,allowed:ReadonlySet<string>,links:readonly KnownLink[]):KnownLink[]{
  return links.filter((link)=>link.ownerId===subscriberId&&(link.kind==="room"||!link.documentId||!allowed.has(link.documentId)))
}
export function generationStillCurrent(started:number,current:number):boolean{return started===current}
