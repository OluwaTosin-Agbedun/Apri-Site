"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
/** Refresh only while preparation is pending; this never signs a reader in. */
export default function AccessJobRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(timer)
  }, [active, router])
  return null
}
