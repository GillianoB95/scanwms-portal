import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DEPLOY_VERSION = '2026-04-04T13:45Z';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log(`[send-email] deploy version ${DEPLOY_VERSION}`);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized', debug_version: DEPLOY_VERSION }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log('[send-email] env check', {
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
    });

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing required server environment variables', debug_version: DEPLOY_VERSION }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error('[send-email] getClaims failed', claimsError);
      return new Response(JSON.stringify({ error: 'Unauthorized', debug_version: DEPLOY_VERSION }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userEmail = typeof claimsData.claims.email === 'string' ? claimsData.claims.email : null;
    const body = await req.json();
    console.log('[send-email] body mode', body?.mode || 'legacy');

    if (body?.mode === 'send_converted_manifest') {
      return await handleConvertedManifest(supabase, body, userEmail);
    }

    const { email_account_id, to, subject, html, inspection_ids, attachments } = body ?? {};
    if (!email_account_id || !to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email_account_id, to, subject, html', debug_version: DEPLOY_VERSION }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('from_email, from_name, resend_api_key')
      .eq('id', email_account_id)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: 'Email account not found', details: accountError?.message, debug_version: DEPLOY_VERSION }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!account.resend_api_key) {
      return new Response(JSON.stringify({ error: 'No Resend API key configured for this email account', debug_version: DEPLOY_VERSION }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fromStr = account.from_name ? `${account.from_name} <${account.from_email}>` : account.from_email;
    const emailPayload: Record<string, unknown> = {
      from: fromStr,
      to: Array.isArray(to) ? to : String(to).split(',').map((e: string) => e.trim()),
      subject,
      html,
    };

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      emailPayload.attachments = attachments;
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.resend_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();
    if (!resendResponse.ok) {
      console.error('[send-email] Resend API error', resendData);
      return new Response(JSON.stringify({ error: 'Resend API error', details: resendData, debug_version: DEPLOY_VERSION }), {
        status: resendResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (inspection_ids && Array.isArray(inspection_ids) && inspection_ids.length > 0 && userEmail) {
      const { error: updateError } = await supabase
        .from('inspections')
        .update({ email_sent_at: new Date().toISOString(), email_sent_by: userEmail })
        .in('id', inspection_ids);
      if (updateError) {
        console.error('[send-email] Failed to update inspection records', updateError);
      }
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id, debug_version: DEPLOY_VERSION }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[send-email] fatal error', message);
    return new Response(JSON.stringify({ error: message, debug_version: DEPLOY_VERSION }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleConvertedManifest(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userEmail: string | null,
) {
  const warehouseId = typeof body.warehouse_id === 'string' ? body.warehouse_id : null;
  const mawb = typeof body.mawb === 'string' ? body.mawb : null;
  const shipmentId = typeof body.shipment_id === 'string' ? body.shipment_id : null;
  const convertedStoragePath = typeof body.converted_storage_path === 'string' ? body.converted_storage_path : null;

  console.log('[ConvertedManifest] Start', { warehouseId, mawb, shipmentId, convertedStoragePath });

  if (!warehouseId || !mawb || !shipmentId || !convertedStoragePath) {
    return new Response(JSON.stringify({ error: 'Missing required fields: warehouse_id, mawb, shipment_id, converted_storage_path', debug_version: DEPLOY_VERSION }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: accounts, error: accountError } = await supabase
    .from('email_accounts')
    .select('id, from_email, from_name, resend_api_key')
    .eq('warehouse_id', warehouseId)
    .eq('is_default', true)
    .limit(1);

  console.log('[ConvertedManifest] Email account lookup', { found: accounts?.length ?? 0, error: accountError?.message ?? null });

  const account = accounts?.[0];
  if (accountError || !account?.resend_api_key) {
    return new Response(JSON.stringify({ error: `No default email account with Resend API key found for warehouse ${warehouseId}`, details: accountError?.message, debug_version: DEPLOY_VERSION }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: templates, error: templateError } = await supabase
    .from('email_templates')
    .select('subject, body, recipients')
    .eq('template_type', 'converted_manifest')
    .limit(1);

  console.log('[ConvertedManifest] Template lookup', { found: templates?.length ?? 0, error: templateError?.message ?? null });

  const template = templates?.[0];
  const recipients = template?.recipients;
  if (templateError || !recipients || (Array.isArray(recipients) && recipients.length === 0)) {
    return new Response(JSON.stringify({ error: 'No recipients configured for converted_manifest template', details: templateError?.message, debug_version: DEPLOY_VERSION }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('shipment-files')
    .createSignedUrl(convertedStoragePath, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('[ConvertedManifest] Signed URL error', signedUrlError);
    return new Response(JSON.stringify({ error: `Failed to generate signed URL: ${signedUrlError?.message || 'unknown'}`, debug_version: DEPLOY_VERSION }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const subject = String(template?.subject || 'Converted manifest ({{mawb}})').replace(/\{\{mawb\}\}/g, mawb);
  const bodyText = String(template?.body || 'Dear customs team,\n\nPlease find attached the converted manifest for shipment {{mawb}}.\n\nKind regards').replace(/\{\{mawb\}\}/g, mawb);
  const htmlBody = bodyText.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
  const fromStr = account.from_name ? `${account.from_name} <${account.from_email}>` : account.from_email;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.resend_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromStr,
      to: Array.isArray(recipients) ? recipients : [recipients],
      subject,
      html: htmlBody,
      attachments: [{
        filename: `${mawb.replace(/\D/g, '')}_customs_converted.xlsx`,
        path: signedUrlData.signedUrl,
      }],
    }),
  });

  const resendData = await resendResponse.json();
  if (!resendResponse.ok) {
    console.error('[ConvertedManifest] Resend API error', resendData);
    return new Response(JSON.stringify({ error: 'Resend API error', details: resendData, debug_version: DEPLOY_VERSION }), {
      status: resendResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[ConvertedManifest] Email sent', { id: resendData.id });

  if (userEmail) {
    const { error: updateError } = await supabase
      .from('shipment_files')
      .update({ email_sent_at: new Date().toISOString(), email_sent_by: userEmail })
      .eq('shipment_id', shipmentId)
      .eq('file_type', 'manifest_converted');
    if (updateError) {
      console.error('[ConvertedManifest] Failed to update shipment_files', updateError);
    }
  }

  return new Response(JSON.stringify({ success: true, id: resendData.id, debug_version: DEPLOY_VERSION }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
