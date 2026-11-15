import { SignInSkeleton } from "@/components/PageSkeleton"

/** The reader sign-in form's own shape, not the library list placeholder. */
export default function Loading() {
  return <SignInSkeleton header="site" />
}
