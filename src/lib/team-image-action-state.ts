export type TeamImageActionState =
  | { status: "idle"; message: "" }
  | {
      status: "success" | "error"
      message: string
    }

export const initialTeamImageState: TeamImageActionState = {
  status: "idle",
  message: "",
}