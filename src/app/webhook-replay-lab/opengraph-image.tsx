import { ImageResponse } from "next/og";
export const alt = "Review your webhook code and download five regression-test scenarios.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: "#f4f2eb", color: "#10231c", padding: "64px", fontFamily: "sans-serif" }}><div style={{ display: "flex", fontSize: 25, letterSpacing: 3 }}>DEPLOYDOCTOR · WEBHOOK PROOF PACK</div><div style={{ display: "flex", flexDirection: "column", fontSize: 78, lineHeight: 1.03, fontWeight: 700, letterSpacing: -5 }}><span>Your webhook.</span><span style={{ color: "#315d4c" }}>Five failure cases.</span></div><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30 }}><span>Paste code. Inspect evidence. Download tests.</span><span style={{ background: "#d1dfd5", padding: "16px 22px", borderRadius: 12 }}>Review code →</span></div></div>, size);
}
