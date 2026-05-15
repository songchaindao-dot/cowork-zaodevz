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
          borderRadius: "38px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
          <div
            style={{
              fontSize: 80,
              fontWeight: 900,
              color: "#3B82F6",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "-3px",
              lineHeight: 1,
            }}
          >
            ZAO
          </div>
          <div
            style={{
              fontSize: 16,
              color: "#93C5FD",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "5px",
              fontWeight: 600,
            }}
          >
            CO-WORKS
          </div>
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
