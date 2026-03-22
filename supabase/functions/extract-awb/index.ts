import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("openai_api_key");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "openai_api_key secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read PDF bytes and extract readable text
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Simple PDF text extraction - read printable ASCII chars
    let pdfText = "";
    for (let i = 0; i < Math.min(bytes.length, 50000); i++) {
      const b = bytes[i];
      if (b >= 32 && b <= 126) {
        pdfText += String.fromCharCode(b);
      } else if (b === 10 || b === 13) {
        pdfText += " ";
      }
    }

    // Compress whitespace
    pdfText = pdfText.replace(/\s+/g, " ").trim().slice(0, 6000);

    const prompt = `You are an air waybill data extraction expert.

Extract these 4 fields from the air waybill text below:
1. MAWB number - format XXX-XXXXXXXX (e.g. 607-50842772). Look for patterns like "123-45678901" or "123 45678901".
2. Number of pieces/colli - total pieces count (look for "No. of Pieces", "PCS", "PIECES", "colli")
3. Gross weight in kg (look for "Gross Weight", "GWT", "KG" near a number)
4. Chargeable weight in kg (look for "Chargeable Weight", "CHWT", "Chargeable")

Return ONLY valid JSON with no explanation:
{"mawb":"607-50842772","pieces":221,"gross_weight":3412.0,"chargeable_weight":3412.0}

Use null for any field you cannot find with confidence.

Air waybill text:
${pdfText}`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "user", content: prompt }
        ],
        max_tokens: 150,
        temperature: 0,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI error:", openaiRes.status, errText);
      return new Response(
        JSON.stringify({ error: "OpenAI API error", details: errText.slice(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await openaiRes.json();
    const content = (result.choices?.[0]?.message?.content || "").trim();

    let extracted: Record<string, unknown> = {};
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    } catch {
      console.error("Parse error:", content);
    }

    return new Response(
      JSON.stringify({
        mawb: typeof extracted.mawb === "string" ? extracted.mawb : null,
        pieces: typeof extracted.pieces === "number" ? extracted.pieces : null,
        gross_weight: typeof extracted.gross_weight === "number" ? extracted.gross_weight : null,
        chargeable_weight: typeof extracted.chargeable_weight === "number" ? extracted.chargeable_weight : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("extract-awb error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
