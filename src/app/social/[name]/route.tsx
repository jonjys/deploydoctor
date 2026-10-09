import { ImageResponse } from "next/og";

// Public 1080x1350 PNG cards for social posts (Instagram needs a plain image URL).
const size = { width: 1080, height: 1350 };
const green = "#34d399";
const mono = "ui-monospace, monospace";

function Frame({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "90px 70px 60px",
      background: "#0a0c10", color: "#f5f7fa", fontFamily: "sans-serif" }}>
      <div style={{ width: 80, height: 12, background: green, display: "flex" }} />
      <div style={{ fontSize: 30, fontWeight: 700, color: green, marginTop: 28, letterSpacing: 1 }}>{kicker}</div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 90, borderRadius: 24, background: green,
        color: "#080c10", fontSize: 50, fontWeight: 700 }}>deploydoctor.nyttolabs.com</div>
    </div>
  );
}

function Overview() {
  const items = ["Next.js entrypoint", "Broken imports", "Vercel-incompatible server code", "Build config and dependencies",
    "Env vars and hardcoded secrets", "Supabase and Prisma boundaries"];
  return (
    <Frame kicker="DEPLOYDOCTOR">
      <div style={{ display: "flex", flexDirection: "column", fontSize: 112, fontWeight: 700, lineHeight: 1.12, marginTop: 50 }}>
        <span>Works locally,</span><span>breaks on</span><span>Vercel?</span>
      </div>
      <div style={{ fontSize: 42, color: "#a0aab9", marginTop: 16 }}>Find out why before you deploy.</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 36, padding: "32px 40px", borderRadius: 28, background: "#141820", border: "2px solid #28303e" }}>
        {items.map((item) => (
          <div key={item} style={{ display: "flex", fontSize: 38, marginBottom: 18 }}>
            <span style={{ color: green, fontWeight: 700, width: 60 }}>+</span><span>{item}</span>
          </div>
        ))}
        <div style={{ fontSize: 30, color: "#828c9b", marginTop: 6 }}>No cloning. No build. No code execution.</div>
      </div>
    </Frame>
  );
}

function Prisma() {
  return (
    <Frame kicker="DEPLOYDOCTOR · VERCEL ERROR OF THE DAY">
      <div style={{ display: "flex", flexDirection: "column", fontSize: 100, fontWeight: 700, lineHeight: 1.15, marginTop: 40 }}>
        <span>Build is green.</span><span>Prisma still</span><span>crashes.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 40, padding: "28px 36px", borderRadius: 24, background: "#1c0e10",
        border: "2px solid #782830", fontFamily: mono, fontSize: 32, lineHeight: 1.4, color: "#e1c8cd" }}>
        <span style={{ color: "#ff828c" }}>PrismaClientInitializationError:</span>
        <span>Prisma has detected that this project was built on Vercel, which caches dependencies. This leads to an outdated Prisma Client.</span>
      </div>
      <div style={{ fontSize: 36, color: "#c8ced7", marginTop: 36, lineHeight: 1.4 }}>
        Why: the install step is cached, so prisma generate never runs again.
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 36, padding: "24px 36px", borderRadius: 24, background: "#101e1a", border: "2px solid #286e5a" }}>
        <span style={{ fontSize: 32, color: "#96dcc3" }}>Fix in package.json:</span>
        <span style={{ fontSize: 36, fontFamily: mono, color: "#ebfaf4", marginTop: 12 }}>{'"postinstall": "prisma generate"'}</span>
      </div>
    </Frame>
  );
}

const cards: Record<string, () => React.ReactElement> = { "card.png": Overview, "prisma.png": Prisma };

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const Card = cards[name];
  if (!Card) return new Response("Not found", { status: 404 });
  return new ImageResponse(<Card />, { ...size, headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
}
