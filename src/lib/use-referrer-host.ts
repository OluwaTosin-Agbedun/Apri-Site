"use client"
/** External browser data without an effect-driven cascading render. Never
 * captures a full referring URL or its query parameters. */
import { useSyncExternalStore } from "react"
const subscribe = () => () => {}
function snapshot(): string {
  try {
    return document.referrer
      ? new URL(document.referrer).hostname.slice(0, 253)
      : ""
  } catch {
    return ""
  }
}
const serverSnapshot = () => ""
export function useReferrerHost(): string {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
