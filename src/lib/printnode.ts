import { supabase } from '@/lib/supabase';

const PRINTNODE_API_KEY = '4634ZRhjj4h1i6wK1IwpPsjXUEBAS-YtEekbuxFHZZU';
const PRINTNODE_PRINTER_ID = 75278110;

export interface PalletLabelData {
  palletId: string;
  subklant: string;
  mawb: string;
  colli: number;
  weight: number;
  hub: string;
  printedAt?: Date;
}

// Generate pallet label PDF as base64 using a simple HTML template
async function generatePalletLabelPdf(data: PalletLabelData): Promise<string> {
  const printedAt = data.printedAt || new Date();
  const dateStr = printedAt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = printedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

  // Simple label HTML (100mm x 150mm)
  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @page { size: 100mm 150mm; margin: 3mm; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; width: 94mm; }
  .subklant { color: #dc2626; font-size: 22pt; font-weight: bold; text-align: center; border: 2px solid #dc2626; padding: 2mm; margin-bottom: 2mm; }
  .pallet-id { color: #ca8a04; font-size: 18pt; font-weight: bold; text-align: center; margin-bottom: 1mm; }
  .datetime { color: #ea580c; font-size: 9pt; text-align: center; margin-bottom: 2mm; }
  .barcode-area { text-align: center; margin: 2mm 0; padding: 2mm; border: 1px solid #000; }
  .barcode-text { font-family: 'Libre Barcode 128', monospace; font-size: 48pt; letter-spacing: 2px; }
  .barcode-num { font-size: 8pt; }
  .mawb { color: #92400e; font-size: 11pt; font-weight: bold; text-align: center; margin: 1mm 0; }
  .cargo { color: #15803d; font-size: 13pt; font-weight: bold; text-align: center; margin: 1mm 0; }
  .hub { color: #000; font-size: 20pt; font-weight: bold; text-align: center; margin-top: 2mm; border: 3px solid #000; padding: 2mm; }
</style>
<link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
</head>
<body>
  <div class="subklant">${data.subklant}</div>
  <div class="pallet-id">PLT-${data.palletId}</div>
  <div class="datetime">${dateStr} ${timeStr}</div>
  <div class="barcode-area">
    <div class="barcode-text">${data.palletId}</div>
    <div class="barcode-num">${data.palletId}</div>
  </div>
  <div class="mawb">MAWB: ${data.mawb}</div>
  <div class="cargo">${data.colli} CTN | ${data.weight.toFixed(2)} KG</div>
  <div class="hub">${data.hub}</div>
</body>
</html>`;

  return btoa(unescape(encodeURIComponent(html)));
}

// Print pallet label via PrintNode
export async function printPalletLabel(data: PalletLabelData): Promise<{ success: boolean; jobId?: number; error?: string }> {
  try {
    const contentBase64 = await generatePalletLabelPdf(data);

    const printJob = {
      printerId: PRINTNODE_PRINTER_ID,
      title: `Pallet Label ${data.palletId}`,
      contentType: 'pdf_base64',
      content: contentBase64,
      source: 'SCANWMS',
      options: {
        copies: 1,
        paper: '4x6',
      },
    };

    const response = await fetch('https://api.printnode.com/printjobs', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(PRINTNODE_API_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(printJob),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PrintNode error: ${error}`);
    }

    const jobId = await response.json();
    return { success: true, jobId };
  } catch (error) {
    console.error('Print failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Generate unique pallet number
export function generatePalletNumber(shipmentId: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `PLT-${timestamp}-${random}`;
}
