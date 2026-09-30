import "server-only"
import type { getSql } from "./db"

let cached=false
export async function editionEntitlementSchemaReady(sql:ReturnType<typeof getSql>):Promise<boolean>{
  if(cached)return true
  try{
    const rows=await sql`select to_regclass('subscriber_subscription_periods') is not null
      and to_regclass('subscriber_publication_exceptions') is not null
      and to_regclass('subscriber_access_reconciliations') is not null as ready` as {ready:boolean}[]
    cached=rows[0]?.ready===true
  }catch{return false}
  return cached
}

export const EDITION_ENTITLEMENT_MIGRATION_PENDING="Edition access is safely closed until db/migrations/20261003_subscription_edition_entitlements.sql is applied."
