/**
 * The one progress indicator for buttons that wait on the server, so a click
 * visibly does something at once. Decorative: the button's own label says
 * what is happening ("Saving…"), so screen readers are not told twice.
 */
export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[1em] w-[1em] shrink-0 rounded-full border-2 border-current border-r-transparent animate-spin motion-reduce:animate-none ${className}`}
    />
  )
}

/** A button label that shows the spinner and a present-tense word while pending. */
export function Busy({ pending, idle, busy }: { pending: boolean; idle: React.ReactNode; busy: string }) {
  return pending ? (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner />
      {busy}
    </span>
  ) : (
    <>{idle}</>
  )
}
