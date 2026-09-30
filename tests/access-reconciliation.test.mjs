import test from "node:test"
import assert from "node:assert/strict"
import {linksToRevoke,generationStillCurrent} from "../src/lib/access-reconciliation-rules.ts"

test("reconciliation revokes excluded exact links and every unrestricted room link for one subscriber only",()=>{
  const links=[{ownerId:"may",kind:"document",documentId:"jan"},{ownerId:"may",kind:"document",documentId:"may"},{ownerId:"may",kind:"room"},{ownerId:"jan",kind:"document",documentId:"jan"},{ownerId:"review",kind:"document",documentId:"jan"}]
  assert.deepEqual(linksToRevoke("may",new Set(["may"]),links),[links[0],links[2]])
})
test("a newer Admin decision fences a stale reconciliation",()=>{assert.equal(generationStillCurrent(4,4),true);assert.equal(generationStillCurrent(4,5),false)})
test("zero eligible documents revokes all subscriber links without touching another reader",()=>{
  const links=[{ownerId:"a",kind:"document",documentId:"x"},{ownerId:"a",kind:"room"},{ownerId:"b",kind:"room"}]
  assert.deepEqual(linksToRevoke("a",new Set(),links),links.slice(0,2))
})
