import { supabase } from './supabase';

/**
 * Send a converted manifest email via the send-email Edge Function.
 */
export async function sendConvertedManifestEmail(params: {
  warehouseId: string;
  mawb: string;
  shipmentId: string;
  convertedStoragePath: string;
  userEmail?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { warehouseId, mawb, shipmentId, convertedStoragePath, userEmail } = params;

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      mode: 'send_converted_manifest',
      warehouse_id: warehouseId,
      mawb,
      shipment_id: shipmentId,
      converted_storage_path: convertedStoragePath,
    },
  });

  if (error) {
    console.error('[sendConvertedManifestEmail] Edge Function error', error);
    return { success: false, error: error.message || 'Edge Function error' };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return { success: true, id: data?.id };
}

/**
 * Send a generic email via the send-email Edge Function.
 */
export async function sendEmailViaResend(params: {
  emailAccountId: string;
  to: string | string[];
  subject: string;
  html: string;
  inspectionIds?: string[];
  userEmail?: string | null;
  attachments?: Array<{ filename: string; content?: string; path?: string }>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { emailAccountId, to, subject, html, inspectionIds, userEmail, attachments } = params;

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      email_account_id: emailAccountId,
      to: Array.isArray(to) ? to : String(to).split(',').map((e: string) => e.trim()),
      subject,
      html,
      inspection_ids: inspectionIds,
      attachments,
    },
  });

  if (error) {
    console.error('[sendEmailViaResend] Edge Function error', error);
    return { success: false, error: error.message || 'Edge Function error' };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return { success: true, id: data?.id };
}
