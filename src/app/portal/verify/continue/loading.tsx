import { SignInSkeleton } from "@/components/PageSkeleton"

/** The sign-in confirmation step's own shape, not the library placeholder. */
export default function Loading() {
  return <SignInSkeleton header="compact" />
}
