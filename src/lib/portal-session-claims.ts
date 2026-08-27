export type PortalPrincipal = {
  principalId: string
  principalType: "subscriber" | "briefing"
}

export function portalPrincipalFromClaims(
  payload: Record<string, unknown>,
): PortalPrincipal | null {
  const principalId = payload.principalId ?? payload.subscriberId
  const principalType = payload.principalType ?? "subscriber"
  if (typeof principalId !== "string") return null
  if (principalType !== "subscriber" && principalType !== "briefing")
    return null
  return { principalId, principalType }
}
