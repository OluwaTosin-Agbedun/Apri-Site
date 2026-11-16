import { ImageResponse } from "next/og"
export const alt =
  "Athena Political & Regulatory Advisory — independent intelligence for decision-makers"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#ffffff",
        color: "#16161a",
        padding: "80px",
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 40 }}>APRA</div>
      <div style={{ fontSize: 64, lineHeight: 1.15, maxWidth: 1000 }}>
        Athena Political &amp; Regulatory Advisory
      </div>
      <div
        style={{
          width: 100,
          height: 4,
          background: "#b49f69",
          marginTop: 36,
          marginBottom: 28,
        }}
      />
      <div style={{ fontSize: 25, color: "#52525b" }}>
        Independent intelligence for decision-makers.
      </div>
    </div>,
    size,
  )
}
