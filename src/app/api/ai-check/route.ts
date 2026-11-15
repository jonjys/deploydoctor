import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "Nyckeln saknas." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 40 || text.length > 8000) {
    return NextResponse.json({ error: "Klistra in en text, 40 till 8000 tecken." }, { status: 400 });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content:
            "Säg om den här texten ser skriven av en modell ut. Svara på svenska, kort. En rad: ja, nej eller oklart. Sen tre korta tecken. Ingen essä.\n\n" +
            text,
        },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Anthropic svarade inte." }, { status: 502 });
  }

  const data = await response.json();
  const answer = data?.content?.[0]?.text ?? "Inget svar.";
  return NextResponse.json({ answer });
}
