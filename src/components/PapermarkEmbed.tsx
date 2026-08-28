'use client'

import { useEffect, useRef, useState } from 'react'

export default function PapermarkEmbed({
  src,
  title = 'Your private Papermark library',
}: {
  src: string
  title?: string
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    setState('loading')
    timeoutRef.current = window.setTimeout(() => setState('error'), 15_000)
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [src, attempt])

  function loaded() {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    setState('ready')
  }

  return (
    <div className="relative w-full min-h-[70vh] lg:min-h-[78vh] border border-border bg-card/30 overflow-hidden">
      {state !== 'ready' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-8 text-center">
          {state === 'loading' ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          ) : (
            <div role="alert">
              <p className="font-medium text-foreground">This could not be loaded.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Check your connection, then try loading the viewer again.
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mt-5 border border-border px-5 py-2 text-sm font-medium hover:border-accent"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      <iframe
        key={`${src}-${attempt}`}
        src={src}
        title={title}
        className="absolute inset-0 h-full w-full border-0"
        allow="fullscreen; clipboard-read; clipboard-write"
        allowFullScreen
        onLoad={loaded}
        onError={() => setState('error')}
      />
    </div>
  )
}
