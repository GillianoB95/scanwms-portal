// PrintNode's pdf_base64 content must contain PDF bytes, not encoded HTML.
export async function htmlToPdfBase64(
  element: HTMLElement,
  format: [number, number] | 'a4',
  margin = 0,
): Promise<string> {
  const { default: html2pdf } = await import('html2pdf.js');
  const dataUri: string = await html2pdf()
    .set({
      margin,
      image: { type: 'png' },
      html2canvas: { scale: 2, backgroundColor: '#fff' },
      jsPDF: { unit: 'mm', format, orientation: 'portrait' },
    })
    .from(element)
    .outputPdf('datauristring');

  const base64 = dataUri.split(',')[1];
  if (!base64?.startsWith('JVBERi0')) {
    throw new Error('PDF generation failed');
  }
  return base64;
}
