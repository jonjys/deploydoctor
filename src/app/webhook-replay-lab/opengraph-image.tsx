import { ImageResponse } from "next/og";
export const alt = "One payment. Five webhook deliveries. Try DeployDoctor's free replay lab.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: "#f4f2eb", color: "#10231c", padding: "64px", fontFamily: "sans-serif" }}><div style={{ display: "flex", fontSize: 25, letterSpacing: 3 }}>DEPLOYDOCTOR · FREE WEBHOOK REPLAY LAB</div><div style={{ display: "flex", flexDirection: "column", fontSize: 92, lineHeight: 1.03, fontWeight: 700, letterSpacing: -5 }}><span>One payment.</span><span style={{ color: "#476500" }}>Five deliveries.</span></div><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30 }}><span>How many times does your app grant access?</span><span style={{ background: "#b9f227", padding: "16px 22px", borderRadius: 12 }}>Try the lab →</span></div></div>, size);
}
