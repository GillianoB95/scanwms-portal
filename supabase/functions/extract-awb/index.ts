import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DEPLOY_VERSION = "2026-03-26T20:40Z";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function regexExtract(text: string) {
  const result: Record<string, unknown> = {
    mawb: null,
    pieces: null,
    gross_weight: null,
    chargeable_weight: null,
    origin: null,
    destination: null,
    shipper: null,
    consignee: null,
  };

  const mawbMatch = text.match(/(\d{3})-(\d{8})/);
  if (mawbMatch) {
    result.mawb = mawbMatch[0];
  } else {
    const mawbAlt = text.match(/(\d{3})\s+\w+\s+(\d{8})/);
    if (mawbAlt) result.mawb = `${mawbAlt[1]}-${mawbAlt[2]}`;
  }

  const dataRowMatch = text.match(/(\d+)\s+(\d+)\s+K\s+[A-Z]\s+(\d+)/);
  if (dataRowMatch) {
    result.pieces = parseInt(dataRowMatch[1], 10);
    result.gross_weight = parseFloat(dataRowMatch[2]);
    result.chargeable_weight = parseFloat(dataRowMatch[3]);
  } else {
    const piecesWeightMatch = text.match(/(\d+)\s+(\d+)\s+K/);
    if (piecesWeightMatch) {
      result.pieces = parseInt(piecesWeightMatch[1], 10);
      result.gross_weight = parseFloat(piecesWeightMatch[2]);
    }

    const cwMatch = text.match(/K\s+[A-Z]\s+(\d+)/);
    if (cwMatch) {
      result.chargeable_weight = parseFloat(cwMatch[1]);
    }
  }

  const routeMatch = text.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})/);
  if (routeMatch) {
    result.origin = routeMatch[1];
    result.destination = routeMatch[2];
  } else {
    const routeAlt = text.match(/([A-Z]{3})\s+(?:to|TO|-)\s+([A-Z]{3})/);
    if (routeAlt) {
      result.origin = routeAlt[1];
      result.destination = routeAlt[2];
    }
  }

  return result;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log(`[extract-awb] deploy version ${DEPLOY_VERSION}`);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    console.log("[extract-awb] FormData keys:", [...formData.keys()]);
    console.log("[extract-awb] File received:", file ? `name=${file.name}, size=${file.size}, type=${file.type}` : "NO FILE");

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided", debug_version: DEPLOY_VERSION }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size === 0) {
      return new Response(
        JSON.stringify({ error: "Empty file received", debug_version: DEPLOY_VERSION }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    console.log("[extract-awb] File bytes length:", bytes.length);

    let pdfText = "";
    for (let i = 0; i < Math.min(bytes.length, 80000); i++) {
      const b = bytes[i];
      if (b >= 32 && b <= 126) {
        pdfText += String.fromCharCode(b);
      } else if (b === 10 || b === 13) {
        pdfText += " ";
      }
    }

    pdfText = pdfText.replace(/\s+/g, " ").trim();

    console.log("[extract-awb] Extracted text length:", pdfText.length);
    console.log("[extract-awb] First 500 chars:", pdfText.slice(0, 500));
    console.log("[extract-awb] Last 500 chars:", pdfText.slice(-500));

    if (pdfText.length < 20) {
      return new Response(
        JSON.stringify({ error: "Could not extract readable text from PDF. The file may be scanned/image-based.", debug_version: DEPLOY_VERSION }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const regexResult = regexExtract(pdfText);
    console.log("[extract-awb] Regex extraction result:", JSON.stringify(regexResult));

    const regexGotNumbers = regexResult.pieces != null && regexResult.gross_weight != null;

    if (regexGotNumbers && regexResult.mawb) {
      console.log("[extract-awb] Using regex results (all key fields found)");
      return new Response(
        JSON.stringify({ ...regexResult, debug_version: DEPLOY_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get("openai_api_key");
    if (!OPENAI_API_KEY) {
      console.log("[extract-awb] No OpenAI key, returning regex-only results");
      return new Response(
        JSON.stringify({ ...regexResult, debug_version: DEPLOY_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const truncatedText = pdfText.slice(0, 8000);

    const prompt = `You are an air waybill data extraction expert. Extract data ONLY from the text provided below. If you cannot find a field, use null. NEVER invent values.

Extract:
1. mawb - format XXX-XXXXXXXX (3 digits dash 8 digits)
2. pieces - integer, number of pieces/colli (look for number before CTN/PCS/PIECES or before weight)
3. gross_weight - number in kg
4. chargeable_weight - number in kg
5. origin - 3-letter IATA airport code of origin
6. destination - 3-letter IATA airport code of destination
7. shipper - shipper/sender name
8. consignee - consignee/receiver name

Return ONLY a JSON object. No explanation. No markdown. Example format:
{"mawb":"123-45678901","pieces":10,"gross_weight":500.0,"chargeable_weight":500.0,"origin":"XXX","destination":"YYY","shipper":"Name","consignee":"Name"}

Text from the uploaded air waybill:
${truncatedText}`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("[extract-awb] OpenAI error:", openaiRes.status, errText);
      return new Response(
        JSON.stringify({ ...regexResult, debug_version: DEPLOY_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await openaiRes.json();
    const content = (result.choices?.[0]?.message?.content || "").trim();
    console.log("[extract-awb] OpenAI response:", content);

    let extracted: Record<string, unknown> = {};
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    } catch {
      console.error("[extract-awb] JSON parse error from OpenAI:", content);
    }

    const final = {
      mawb: (regexResult.mawb as string) || (typeof extracted.mawb === "string" ? extracted.mawb : null),
      pieces: (regexResult.pieces as number) ?? (typeof extracted.pieces === "number" ? extracted.pieces : null),
      gross_weight: (regexResult.gross_weight as number) ?? (typeof extracted.gross_weight === "number" ? extracted.gross_weight : null),
      chargeable_weight: (regexResult.chargeable_weight as number) ?? (typeof extracted.chargeable_weight === "number" ? extracted.chargeable_weight : null),
      origin: (regexResult.origin as string) || (typeof extracted.origin === "string" ? extracted.origin : null),
      destination: (regexResult.destination as string) || (typeof extracted.destination === "string" ? extracted.destination : null),
      shipper: typeof extracted.shipper === "string" ? extracted.shipper : null,
      consignee: typeof extracted.consignee === "string" ? extracted.consignee : null,
      debug_version: DEPLOY_VERSION,
    };

    console.log("[extract-awb] Final merged result:", JSON.stringify(final));

    return new Response(
      JSON.stringify(final),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[extract-awb] error:", msg);
    return new Response(
      JSON.stringify({ error: msg, debug_version: DEPLOY_VERSION }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
