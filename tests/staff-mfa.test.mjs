import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { totp, matchingTotpStep, newAuthenticatorSecret, newRecoveryCodes, recoveryHash, sealStaffSecret, openStaffSecret } from "../src/lib/admin-mfa.ts"

test("TOTP matches all RFC 6238 SHA-1 test vectors",()=>{
  const seed="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  for (const [seconds,expected] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]]) assert.equal(totp(seed,Math.floor(seconds/30),8),expected)
})
test("OTP checks have bounded clock tolerance and refuse a used step",()=>{
  const secret=newAuthenticatorSecret(); const step=123456
  assert.equal(matchingTotpStep(secret,totp(secret,step),step*30_000),step)
  assert.equal(matchingTotpStep(secret,totp(secret,step),step*30_000,step),null)
  assert.equal(matchingTotpStep(secret,totp(secret,step-1),step*30_000),step-1)
  assert.equal(matchingTotpStep(secret,"12345x",step*30_000),null)
  assert.throws(()=>totp(secret,-1))
})
test("encrypted authenticator material is randomized, authenticated and account-bound",()=>{
  const master=randomBytes(32).toString("hex"); const value=newAuthenticatorSecret()
  const one=sealStaffSecret(value,master,"reader-one"); const two=sealStaffSecret(value,master,"reader-one")
  assert.notEqual(one,two); assert.ok(!one.includes(value))
  assert.equal(openStaffSecret(one,master,"reader-one"),value)
  assert.throws(()=>openStaffSecret(one,master,"reader-two"))
  assert.throws(()=>openStaffSecret(one,randomBytes(32).toString("hex"),"reader-one"))
  const parts=one.split(".");parts[3]=(parts[3][0]==="A"?"B":"A")+parts[3].slice(1)
  assert.throws(()=>openStaffSecret(parts.join("."),master,"reader-one"))
})
test("recovery codes are high-entropy, normalized keyed hashes bound to staff identity",()=>{
  const codes=newRecoveryCodes();const master=randomBytes(32).toString("hex")
  assert.equal(codes.length,10);assert.equal(new Set(codes).size,10)
  for(const code of codes) assert.match(code,/^[0-9a-f]{6}(?:-[0-9a-f]{6}){3}$/)
  assert.equal(recoveryHash(codes[0],master,"a"),recoveryHash(codes[0].replaceAll("-","").toUpperCase(),master,"a"))
  assert.notEqual(recoveryHash(codes[0],master,"a"),recoveryHash(codes[0],master,"b"))
  assert.equal(recoveryHash("not-a-recovery-code",master,"a"),null)
})
