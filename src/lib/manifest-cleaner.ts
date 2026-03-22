// Manifest Cleaner API configuration
export const MANIFEST_CLEANER_URL = 'https://humble-charisma-production-9829.up.railway.app';

export async function processManifest(file: File): Promise<{
  cleanedFile: Blob;
  validation: { errors: string[]; warnings: string[] };
  summary: { totalParcels: number; totalWeight: number };
} | null> {
  try {
    const formData = new FormData();
    formData.append('manifest', file);

    const response = await fetch(`${MANIFEST_CLEANER_URL}/process`, {
      method: 'POST',
      body: formData,
    });

    if (response.status === 422) {
      const data = await response.json();
      return {
        cleanedFile: new Blob(),
        validation: {
          errors: data.errors || [],
          warnings: data.warnings || [],
        },
        summary: { totalParcels: 0, totalWeight: 0 },
      };
    }

    if (!response.ok) {
      throw new Error(`Manifest cleaner error: ${response.status}`);
    }

    // Get validation info from headers if available
    const cleanedBlob = await response.blob();
    
    return {
      cleanedFile: cleanedBlob,
      validation: { errors: [], warnings: [] },
      summary: { totalParcels: 0, totalWeight: 0 },
    };
  } catch (error) {
    console.error('Manifest cleaner failed:', error);
    return null;
  }
}
