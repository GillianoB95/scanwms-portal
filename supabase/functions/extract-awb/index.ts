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
    pdfText = pdfText.replace(/\s+/g, " ").trim().slice(0, 8000);

    const prompt = `You are an air waybill data extraction expert. Extract data ONLY from the text provided below. Do NOT invent, guess, or use default values. If you cannot find a field with confidence, use null.

Extract these fields from the air waybill text:
1. MAWB number - format XXX-XXXXXXXX (3 digits, dash, 8 digits). Look for patterns like "080-38801545" or "080 38801545".
2. Number of pieces/colli - integer. Look for number before CTN, PCS, PIECES, or in "No. of Pieces" field.
3. Gross weight in kg - numeric. Look for a number followed by K or KG in the weight section.
4. Chargeable weight in kg - numeric. Look for "Chargeable Weight" or "CHWT" value.
5. Origin airport - 3-letter IATA code from the routing/origin section (e.g. TAS, PEK, IST).
6. Destination airport - 3-letter IATA code from the routing/destination section (e.g. AMS, FRA, LHR).
7. Shipper name - the company or person shipping the goods (look for "Shipper", "Sender", "Afzender").
8. Consignee name - the company or person receiving the goods (look for "Consignee", "Ontvanger").

CRITICAL RULES:
- Only extract values you can actually see in the text below.
- If a value is not clearly present, use null. Never fabricate data.
- Return ONLY valid JSON with no explanation or markdown.

Return format:
{"mawb":"080-38801545","pieces":83,"gross_weight":1140.0,"chargeable_weight":1140.0,"origin":"TAS","destination":"AMS","shipper":"Company Name","consignee":"Company Name"}

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
        max_tokens: 300,
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
        origin: typeof extracted.origin === "string" ? extracted.origin : null,
        destination: typeof extracted.destination === "string" ? extracted.destination : null,
        shipper: typeof extracted.shipper === "string" ? extracted.shipper : null,
        consignee: typeof extracted.consignee === "string" ? extracted.consignee : null,
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
