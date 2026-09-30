"use client"

import { useActionState } from "react"
import { moveReviewEdition } from "@/app/actions/review-admin"

type Edition = { id: string; title: string; label: string }

function Move({ id, direction, disabled, title }: { id: string; direction: "up" | "down"; disabled: boolean; title: string }) {
  const [state, action, pending] = useActionState(moveReviewEdition, undefined)
  return (
    <form action={action} className="inline">
      <input type="hidden" name="editionId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled || pending}
        aria-label={`Move ${title} ${direction}`}
        className="border border-border px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-30 cursor-pointer disabled:cursor-default"
      >
        {pending ? "…" : direction === "up" ? "↑ Up" : "↓ Down"}
      </button>
      {state?.message && !state.ok && <span className="ml-2 text-xs text-red-700">{state.message}</span>}
    </form>
  )
}

/**
 * The order published review editions appear in on the Publications page,
 * one list per series, first at the top. One click moves an edition.
 */
export default function EditionOrder({ groups }: { groups: { series: string; label: string; editions: Edition[] }[] }) {
  if (groups.every((g) => g.editions.length === 0)) return null
  return (
    <section className="mb-8 border border-border bg-card/30 p-6">
      <h2 className="font-serif text-xl mb-1">Order on the Publications page</h2>
      <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
        Published editions, in the order readers see them: the top one comes first in its series. Move one up or down;
        the page updates straight away.
      </p>
      <div className="grid gap-6 md:grid-cols-3">
        {groups.filter((g) => g.editions.length > 0).map((g) => (
          <div key={g.series} className="min-w-0">
            <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">{g.label}</h3>
            <ol className="space-y-2">
              {g.editions.map((e, i) => (
                <li key={e.id} className="border border-border p-3 text-sm">
                  <p className="break-words">
                    <span className="text-muted-foreground tabular-nums mr-2">{i + 1}.</span>
                    {e.title}
                  </p>
                  {e.label && <p className="text-xs text-muted-foreground mt-0.5">{e.label}</p>}
                  <div className="mt-2 flex gap-2">
                    <Move id={e.id} direction="up" disabled={i === 0} title={e.title} />
                    <Move id={e.id} direction="down" disabled={i === g.editions.length - 1} title={e.title} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}
