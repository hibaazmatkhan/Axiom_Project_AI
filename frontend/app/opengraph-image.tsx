import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Alice in Borderland: The Last Room";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "radial-gradient(circle at 78% 18%, rgba(226,59,59,0.32), transparent 38%), radial-gradient(circle at 12% 82%, rgba(232,181,58,0.22), transparent 42%), #040507",
          color: "#f4f1ea",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "2px solid #e23b3b",
              padding: "8px 16px",
              color: "#e23b3b",
              fontSize: 22,
              letterSpacing: 6,
            }}
          >
            <span style={{ marginRight: 10 }}>♠</span> LIVE BROADCAST
          </div>
          <div style={{ fontSize: 20, letterSpacing: 4, color: "#8a8f98" }}>
            5×5 · FOUR PLAYERS · ONE DOOR
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 128, lineHeight: 0.9, letterSpacing: 2, fontWeight: 800 }}>
            THE LAST ROOM
          </div>
          <div style={{ fontSize: 34, color: "#e8b53a", letterSpacing: 8 }}>
            ALICE IN BORDERLAND
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#8a8f98" }}>
          <span>EVERY DOOR IS A CHOICE. EVERY ROOM CAN MOVE.</span>
          <span style={{ color: "#f4f1ea" }}>AXIOM</span>
        </div>
      </div>
    ),
    size
  );
}
