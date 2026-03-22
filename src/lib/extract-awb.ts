/**
 * Client-side Air Waybill PDF text extraction.
 * Uses pdfjs-dist to read the PDF, then regex to find MAWB, weight, and piece count.
 */
import * as pdfjsLib from 'pdfjs-dist';

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

export interface AwbExtractedData {
  mawb: string | null;
  colli: number | null;
  grossWeight: number | null;
  chargeableWeight: number | null;
}

export async function extractAwbData(file: File): Promise<AwbExtractedData> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }

  // Extract MAWB: pattern XXX-XXXXXXXX (3 digits, dash, 8 digits)
  const mawbMatch = fullText.match(/(\d{3})\s*[-–]\s*(\d{8})/);
  const mawb = mawbMatch ? `${mawbMatch[1]}-${mawbMatch[2]}` : null;

  // Extract weights: look for patterns like "1234.5" or "1234" near "kg" or "K"
  const weightMatches = [...fullText.matchAll(/(\d[\d,]*\.?\d*)\s*(?:kg|KG|K\.?G\.?|kgs)/gi)];
  const weights = weightMatches
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(w => w > 0 && w < 100000)
    .sort((a, b) => a - b);

  // Extract piece/colli count: look for patterns near "pieces", "pcs", "colli"
  const colliMatch = fullText.match(/(\d+)\s*(?:pieces|pcs|colli|COLLI|PCS|PIECES)/i);
  const colli = colliMatch ? parseInt(colliMatch[1], 10) : null;

  // Heuristic: if we found 2+ weights, smaller is gross, larger is chargeable
  const grossWeight = weights.length >= 2 ? weights[0] : weights.length === 1 ? weights[0] : null;
  const chargeableWeight = weights.length >= 2 ? weights[weights.length - 1] : null;

  return { mawb, colli, grossWeight, chargeableWeight };
}
