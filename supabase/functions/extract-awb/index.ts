import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("openai_api_key");
    if (!OPENAI_API_KEY) {
      throw new Error("openai_api_key is not configured");
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read PDF as binary and extract text using simple pattern matching
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Convert to string to find text patterns (PDF text is often readable)
    let pdfText = "";
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte >= 32 && byte <= 126) {
        pdfText += String.fromCharCode(byte);
      } else {
        pdfText += " ";
      }
    }
    
    // Clean up the text - compress whitespace
    pdfText = pdfText.replace(/\s+/g, " ").slice(0, 8000);

    // Call OpenAI GPT-4o with text extraction prompt
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an air waybill data extraction expert. Extract specific fields from air waybill text and return only JSON.",
          },
          {
            role: "user",
            content: `Extract from this air waybill text:
1. MAWB number (format: XXX-XXXXXXXX, e.g. 607-50842772)
2. Number of pieces/colli (total pieces count)
3. Gross weight in kg (look for "Gross Weight" or "GWT" followed by a number)
4. Chargeable weight in kg (look for "Chargeable Weight" or "CHWT" followed by a number)

Return ONLY valid JSON, no explanation:
{"mawb": "607-50842772", "pieces": 221, "gross_weight": 3412.0, "chargeable_weight": 3412.0}

If a field cannot be found, use null.

Air waybill text:
${pdfText}`,
          },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("OpenAI API error:", openaiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "OpenAI API error" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await openaiResponse.json();
    const content = result.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let extracted;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      extracted = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse OpenAI response:", content);
      return new Response(
        JSON.stringify({ error: "Could not parse extraction result" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        mawb: extracted.mawb || null,
        pieces: typeof extracted.pieces === "number" ? extracted.pieces : null,
        gross_weight: typeof extracted.gross_weight === "number" ? extracted.gross_weight : null,
        chargeable_weight: typeof extracted.chargeable_weight === "number" ? extracted.chargeable_weight : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("extract-awb error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
