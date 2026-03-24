export interface PalletLabelData {
  palletId: string;
  subklant: string;
  mawb: string;
  colli: number;
  weight: number;
  hub: string;
  printedAt?: Date;
}

// Minimal Code128B barcode SVG generator
function generateCode128Svg(text: string, width = 280, height = 70): string {
  const CODE128B_START = 104;
  const CODE128_STOP = 106;
  const PATTERNS = [
    '11011001100','11001101100','11001100110','10010011000','10010001100',
    '10001001100','10011001000','10011000100','10001100100','11001001000',
    '11001000100','11000100100','10110011100','10011011100','10011001110',
    '10111001100','10011101100','10011100110','11001110010','11001011100',
    '11001001110','11011100100','11001110100','11100101100','11100100110',
    '11101100100','11100110100','11100110010','11011011000','11011000110',
    '11000110110','10100011000','10001011000','10001000110','10110001000',
    '10001101000','10001100010','11010001000','11000101000','11000100010',
    '10110111000','10110001110','10001101110','10111011000','10111000110',
    '10001110110','11101110110','11010001110','11000101110','11011101000',
    '11011100010','11011101110','11101011000','11101000110','11100010110',
    '11101101000','11101100010','11100011010','11101111010','11001000010',
    '11110001010','10100110000','10100001100','10010110000','10010000110',
    '10000101100','10000100110','10110010000','10110000100','10011010000',
    '10011000010','10000110100','10000110010','11000010010','11001010000',
    '11110111010','11000010100','10001111010','10100111100','10010111100',
    '10010011110','10111100100','10011110100','10011110010','11110100100',
    '11110010100','11110010010','11011011110','11011110110','11110110110',
    '10101111000','10100011110','10001011110','10111101000','10111100010',
    '10001111010','11110101000','11110100010','10111011110','10111101110',
    '11101011110','11110101110','11010000100','11010010000','11010011100',
    '1100011101011',
  ];

  let checksum = CODE128B_START;
  const codes = [CODE128B_START];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    codes.push(code);
    checksum += code * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);

  let binary = '';
  for (const code of codes) binary += PATTERNS[code];

  const barCount = binary.length;
  const barWidth = width / barCount;

  let bars = '';
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      bars += `<rect x="${(i * barWidth).toFixed(2)}" y="0" width="${Math.max(barWidth, 0.8).toFixed(2)}" height="${height}" fill="#000"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bars}</svg>`;
}

// Generate pallet label HTML as base64 for PrintNode (10x15cm thermal label, B&W)
export function generatePalletLabelHtml(data: PalletLabelData): string {
  const printedAt = data.printedAt || new Date();
  const dateStr = printedAt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = printedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

  const barcodeSvg = generateCode128Svg(data.palletId, 340, 80);

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    margin: 0;
    padding: 4mm;
    width: 100mm;
    height: 150mm;
    color: #000;
    display: flex;
    flex-direction: column;
  }
  .subklant {
    font-size: 28pt;
    font-weight: bold;
    text-align: center;
    border: 3px solid #000;
    padding: 4mm;
    margin-bottom: 3mm;
  }
  .pallet-id {
    font-size: 22pt;
    font-weight: bold;
    text-align: center;
    margin-bottom: 2mm;
  }
  .datetime {
    font-size: 11pt;
    text-align: center;
    margin-bottom: 3mm;
  }
  .barcode-area {
    text-align: center;
    margin: 3mm 0;
    padding: 3mm;
    border: 2px solid #000;
  }
  .barcode-area svg {
    width: 85mm;
    height: 22mm;
  }
  .mawb {
    font-size: 14pt;
    font-weight: bold;
    text-align: center;
    margin: 3mm 0;
  }
  .cargo {
    font-size: 16pt;
    font-weight: bold;
    text-align: center;
    padding: 4mm;
    margin: 3mm 0;
    border: 3px solid #000;
  }
  .hub {
    font-size: 32pt;
    font-weight: bold;
    text-align: center;
    margin-top: auto;
    border: 4px solid #000;
    padding: 5mm;
  }
</style>
</head>
<body>
  <div class="subklant">${data.subklant}</div>
  <div class="pallet-id">${data.palletId}</div>
  <div class="datetime">${dateStr} ${timeStr}</div>
  <div class="barcode-area">
    ${barcodeSvg}
  </div>
  <div class="mawb">MAWB: ${data.mawb}</div>
  <div class="cargo">${data.colli} CTN | ${data.weight.toFixed(2)} KG</div>
  <div class="hub">${data.hub}</div>
</body>
</html>`;

  return btoa(unescape(encodeURIComponent(html)));
}

// Print pallet label via PrintNode using warehouse-specific credentials
export async function printPalletLabel(
  data: PalletLabelData,
  printnodeKey: string,
  printnodeId: string,
): Promise<{ success: boolean; jobId?: number; error?: string }> {
  try {
    const contentBase64 = generatePalletLabelHtml(data);

    const printJob = {
      printerId: parseInt(printnodeId),
      title: `Pallet Label ${data.palletId}`,
      contentType: 'raw_base64',
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
        'Authorization': `Basic ${btoa(printnodeKey + ':')}`,
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
