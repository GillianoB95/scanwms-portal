/**
 * Client-side AWB PDF parser using pdfjs-dist.
 * Extracts MAWB, pieces, weights, origin, destination, shipper, consignee
 * from uploaded air waybill PDFs — no server call needed.
 */
import * as pdfjsLib from 'pdfjs-dist';

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export interface AwbParsedData {
  mawb: string | null;
  pieces: number | null;
  gross_weight: number | null;
  chargeable_weight: number | null;
  origin: string | null;
  destination: string | null;
  shipper: string | null;
  consignee: string | null;
}

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str);
    pages.push(strings.join(' '));
  }

  return pages.join('\n');
}

export async function parseAwbPdf(file: File): Promise<AwbParsedData> {
  const result: AwbParsedData = {
    mawb: null,
    pieces: null,
    gross_weight: null,
    chargeable_weight: null,
    origin: null,
    destination: null,
    shipper: null,
    consignee: null,
  };

  const text = await extractTextFromPdf(file);
  console.log('[parseAwbPdf] Extracted text length:', text.length);
  console.log('[parseAwbPdf] Full text:', text);

  if (!text || text.length < 10) return result;

  // MAWB: XXX-XXXXXXXX
  const mawbMatch = text.match(/(\d{3})-(\d{8})/);
  if (mawbMatch) {
    result.mawb = mawbMatch[0];
  } else {
    // Try space-separated: e.g. "080  38801545"
    const mawbAlt = text.match(/(\d{3})\s+(\d{8})/);
    if (mawbAlt) result.mawb = `${mawbAlt[1]}-${mawbAlt[2]}`;
  }

  // Weight data row: "83  1140  K  Q  1140" or similar
  const weightLine = text.match(/(\d+)\s+(\d+)\s+K\s+[A-Z]?\s*(\d+)/);
  if (weightLine) {
    result.pieces = parseInt(weightLine[1], 10);
    result.gross_weight = parseFloat(weightLine[2]);
    result.chargeable_weight = parseFloat(weightLine[3]);
  } else {
    // Fallback: pieces + weight before K
    const pwMatch = text.match(/(\d+)\s+(\d+)\s+K/);
    if (pwMatch) {
      result.pieces = parseInt(pwMatch[1], 10);
      result.gross_weight = parseFloat(pwMatch[2]);
    }
    // Chargeable weight after K + rate class letter
    const cwMatch = text.match(/K\s+[A-Z]\s+(\d+)/);
    if (cwMatch) {
      result.chargeable_weight = parseFloat(cwMatch[1]);
    }
  }

  // Origin: 3-letter code before slash in routing
  const originMatch = text.match(/([A-Z]{3})\s*\//);
  if (originMatch) {
    result.origin = originMatch[1];
  }

  // Destination: after "Airport of Destination" or after slash in routing
  const destMatch = text.match(/Airport\s+of\s+Destination[^A-Z]*([A-Z]{3})/i);
  if (destMatch) {
    result.destination = destMatch[1];
  } else {
    // Try slash routing: "TAS / AMS" or "TAS/AMS"
    const routeMatch = text.match(/[A-Z]{3}\s*\/\s*([A-Z]{3})/);
    if (routeMatch) {
      result.destination = routeMatch[1];
    }
  }

  // Shipper: look for "Shipper" label followed by a name
  const shipperMatch = text.match(/Shipper['s]*\s+Name[^A-Za-z]*([A-Za-z][A-Za-z\s.,&-]{2,60})/i);
  if (shipperMatch) {
    result.shipper = shipperMatch[1].trim();
  }

  // Consignee: look for "Consignee" label followed by a name
  const consigneeMatch = text.match(/Consignee['s]*\s+Name[^A-Za-z]*([A-Za-z][A-Za-z\s.,&-]{2,60})/i);
  if (consigneeMatch) {
    result.consignee = consigneeMatch[1].trim();
  }

  console.log('[parseAwbPdf] Parsed result:', JSON.stringify(result));
  return result;
}
