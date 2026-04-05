import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, Download, FileCheck, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
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
          mawb: file.name.replace('.xlsx', ''),
          mode: 'clean',
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
    setError(null);

    const downloadName = file?.name ? `cleaned_${file.name}` : 'manifest_cleaned.xlsx';
    const triggerDownload = (url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    const attempts = [
      { bucket: 'shipment-files', path: storagePath.replace(/^\/+/, '') },
      { bucket: 'manifests', path: storagePath.replace(/^manifests\//, '').replace(/^\/+/, '') },
      { bucket: 'shipments', path: storagePath.replace(/^shipments\//, '').replace(/^\/+/, '') },
      {
        bucket: storagePath.split('/')[0],
        path: storagePath.split('/').slice(1).join('/').replace(/^\/+/, ''),
      },
    ].filter((attempt, index, all) => {
      return attempt.bucket && attempt.path && all.findIndex((item) => item.bucket === attempt.bucket && item.path === attempt.path) === index;
    });

    for (const { bucket, path } of attempts) {
      const storage = supabase.storage.from(bucket);

      const { data: signedData, error: signedError } = await storage.createSignedUrl(path, 300);
      if (!signedError && signedData?.signedUrl) {
        triggerDownload(signedData.signedUrl);
        return;
      }

      console.log(`[Download] Signed URL failed for bucket "${bucket}" path "${path}":`, signedError?.message);

      const { data: fileData, error: fileError } = await storage.download(path);
      if (!fileError && fileData) {
        const objectUrl = URL.createObjectURL(fileData);
        triggerDownload(objectUrl);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return;
      }

      console.log(`[Download] Direct download failed for bucket "${bucket}" path "${path}":`, fileError?.message);
    }

    setError(`Failed to create download URL. Storage path: ${storagePath}`);
  }, [storagePath, file]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manifest Cleaner</h1>
        <p className="text-muted-foreground mt-1">
          Upload an original manifest to clean it (names, addresses, prices, weights, HS codes)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Manifest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Select .xlsx file</label>
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
                Cleaning manifest…
              </>
            ) : (
              <>
                <FileCheck className="h-4 w-4" />
                Clean Manifest
              </>
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
