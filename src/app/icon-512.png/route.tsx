import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #041225 0%, #0a1f3d 60%, #0c2a50 100%)",
          borderRadius: "100px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              fontSize: 220,
              fontWeight: 900,
              color: "#3B82F6",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "-8px",
              lineHeight: 1,
            }}
          >
            ZAO
          </div>
          <div
            style={{
              fontSize: 42,
              color: "#93C5FD",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "12px",
              fontWeight: 600,
            }}
          >
            CO-WORKS
          </div>
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
