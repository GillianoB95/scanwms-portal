import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, Download, FileSpreadsheet, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ProcessStats {
  input: number;
  output: number;
  ai_classified: number;
  learned?: { names: number; hs: number };
}

export default function ManifestCleaner() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [stats, setStats] = useState<ProcessStats | null>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setStoragePath(null);
      setStats(null);
    }
  }, []);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    setStoragePath(null);
    setStats(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

      const { data: rawResponse, error: fnError } = await supabase.functions.invoke('process-manifest', {
        body: {
          rows,
          shipmentId: 'preview-' + Date.now(),
          mawb: 'PREVIEW',
        },
      });

      if (fnError) throw new Error(fnError.message || 'Edge function error');

      const processed = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;

      if (!processed?.success) throw new Error(processed?.error || 'Processing failed');

      setStoragePath(processed.storagePath);
      setStats(processed.stats || null);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setProcessing(false);
    }
  }, [file]);

  const handleDownload = useCallback(async () => {
    if (!storagePath) return;
    const { data, error: dlError } = await supabase.storage
      .from('shipments')
      .createSignedUrl(storagePath.replace(/^shipments\//, ''), 300);

    if (dlError || !data?.signedUrl) {
      setError('Failed to create download URL');
      return;
    }

    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = 'manifest_cleaned.xlsx';
    a.click();
  }, [storagePath]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Manifest Cleaner</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload & Process
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Upload original manifest</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
            />
            {file && <p className="text-sm text-muted-foreground mt-1">{file.name}</p>}
          </div>

          <Button onClick={handleProcess} disabled={!file || processing}>
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              'Clean & Convert'
            )}
          </Button>

          {error && (
            <div className="flex items-start gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-primary" />
              Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold">{stats.input}</p>
                <p className="text-sm text-muted-foreground">Input rows</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold">{stats.output}</p>
                <p className="text-sm text-muted-foreground">Output rows</p>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold">{stats.ai_classified}</p>
                <p className="text-sm text-muted-foreground">AI classified</p>
              </div>
            </div>

            {storagePath && (
              <Button onClick={handleDownload} variant="outline" className="w-full">
                <Download className="h-4 w-4" />
                Download cleaned manifest
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
