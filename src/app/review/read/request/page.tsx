import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/** The older "enter your email to reach your room" page: readers now sign in to the Review Library with one code. */
export default function ReadRequest(): never {
  redirect("/review/library/sign-in")
}
