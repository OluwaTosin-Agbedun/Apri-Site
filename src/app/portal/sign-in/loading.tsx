import { SignInSkeleton } from "@/components/PageSkeleton"

/** The sign-in form's own shape, so it never borrows the library placeholder. */
export default function Loading() {
  return <SignInSkeleton header="compact" />
}
