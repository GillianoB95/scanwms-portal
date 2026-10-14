import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCmrWorkbook, printCmrViaPrintNode } from './cmr-generator';
import { printPalletLabel } from './printnode';
import { htmlToPdfBase64 } from './html-to-pdf';

vi.mock('./html-to-pdf', () => ({ htmlToPdfBase64: vi.fn() }));

const pdfBytes = btoa('%PDF-1.4\n');
const renderPdf = vi.mocked(htmlToPdfBase64);

beforeEach(() => {
  renderPdf.mockReset().mockResolvedValue(pdfBytes);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => 123,
  }));
});

describe('PrintNode PDF jobs', () => {
  it('renders pallet label HTML as a 100x150 mm PDF before submitting', async () => {
    const result = await printPalletLabel({
      palletId: 'PLT001', subklant: 'Acme & Co', mawb: '123-45678901',
      colli: 12, weight: 34.5, hub: 'AMS', printedAt: new Date('2026-10-14T10:00:00Z'),
    }, 'test-key', '42');

    expect(result).toEqual({ success: true, jobId: 123 });
    const [html, format] = renderPdf.mock.calls[0];
    expect(format).toEqual([100, 150]);
    expect(html.querySelector('.label-page')?.textContent).toContain('Acme & Co');
    expect(html.querySelector('svg rect')).not.toBeNull();
    expect(html.querySelector('style')?.textContent).toContain('.label-page');
    const job = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(job).toMatchObject({ printerId: 42, contentType: 'pdf_base64', content: pdfBytes });
  });

  it('renders CMR workbook cells into an A4 PDF before submitting', async () => {
    const wb = generateCmrWorkbook({
      warehouseName: 'Acme Warehouse', warehouseStreet: 'Main St 1',
      warehousePostalCity: '1000 AA Amsterdam', warehouseCountry: 'Netherlands',
      warehouseCity: 'Amsterdam', hubName: 'Hub', hubStreet: 'Second St',
      hubHouseNumber: '2', hubPostalCode: '2000 BB', hubCity: 'Rotterdam',
      hubCountry: 'Netherlands', truckReference: 'TRUCK123',
      outboundNumber: 'OUT123', sealNumber: 'SEAL123',
      lines: [{ mawb: '123-45678901', colli: 12, weightKg: 34.5 }],
    });

    const result = await printCmrViaPrintNode(wb, '43', 'test-key', 'CMR test', 4);

    expect(result).toEqual({ success: true, jobId: 123 });
    const [html, format, margin] = renderPdf.mock.calls[0];
    expect([format, margin]).toEqual(['a4', 10]);
    expect(html.querySelector('tr:first-child td:nth-child(2)')?.textContent).toBe('Acme Warehouse');
    expect(html.querySelector('tr:nth-child(26) td:nth-child(2)')?.textContent).toBe('123-45678901');
    expect(html.querySelector('tr:nth-child(41) td:nth-child(4)')?.textContent).toBe('12 colli');
    const job = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(job).toMatchObject({ printerId: 43, contentType: 'pdf_base64', content: pdfBytes, options: { copies: 4 } });
  });
});
