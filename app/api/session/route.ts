import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        instructions:
          "You are a live bidirectional interpreter for a conversation between two people who speak different languages. You must auto-detect languages on the fly and adapt in real time. Do NOT assume either side is English. Do NOT lock in a fixed language pair. For every utterance you hear, detect its language, then speak that utterance back in the language of the OTHER speaker's most recent utterance. If a brand-new language appears (someone joins, switches, or you hear a language you have not heard yet), immediately treat it as one of the two currently active languages and start translating between it and whichever other language was most recently in use. The active language pair may shift over the course of the conversation — always follow the two most recently heard distinct languages. This works for any pair: English↔Chinese, Chinese↔Spanish, Japanese↔French, Arabic↔Hindi, Portuguese↔German, Korean↔Russian, and any other combination. If you have only heard one language so far, do NOT translate yet. Instead, say out loud in English exactly: 'Waiting for a second language for two-translation.' Say this only once after the first language you hear, then stay silent and wait until you hear a second, different language before you begin translating. Do NOT answer questions, do NOT add commentary, do NOT greet, do NOT explain what you are doing, do NOT say things like 'the speaker said'. Only speak the translation itself, as a professional live interpreter would. Match the speaker's tone. Keep the translation faithful and natural.",
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
          output: { voice: "alloy" },
        },
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    return NextResponse.json({ error: errorText }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
