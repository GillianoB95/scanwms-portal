import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();

    // Mode: send_converted_manifest — server-side lookup of email account + template
    if (body.mode === 'send_converted_manifest') {
      return await handleConvertedManifest(supabase, body, user, corsHeaders);
    }

    // Legacy mode: direct email send
    const { email_account_id, to, subject, html, inspection_ids, attachments } = body;

    if (!email_account_id || !to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email_account_id, to, subject, html' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the email account to get Resend API key
    const { data: account, error: accError } = await supabase
      .from('email_accounts')
      .select('from_email, from_name, resend_api_key')
      .eq('id', email_account_id)
      .single();

    if (accError || !account) {
      return new Response(JSON.stringify({ error: 'Email account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!account.resend_api_key) {
      return new Response(JSON.stringify({ error: 'No Resend API key configured for this email account' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send via Resend API
    const fromStr = account.from_name
      ? `${account.from_name} <${account.from_email}>`
      : account.from_email;

    const emailPayload: any = {
      from: fromStr,
      to: Array.isArray(to) ? to : to.split(',').map((e: string) => e.trim()),
      subject,
      html,
    };

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      emailPayload.attachments = attachments;
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${account.resend_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData);
      return new Response(JSON.stringify({ error: 'Resend API error', details: resendData }), {
        status: resendResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If inspection_ids provided, mark them as email sent
    if (inspection_ids && Array.isArray(inspection_ids) && inspection_ids.length > 0) {
      const { error: updateError } = await supabase
        .from('inspections')
        .update({
          email_sent_at: new Date().toISOString(),
          email_sent_by: user.email,
        })
        .in('id', inspection_ids);

      if (updateError) {
        console.error('Failed to update inspection records:', updateError);
      }
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-email error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleConvertedManifest(
  supabase: any,
  body: any,
  user: any,
  corsHeaders: Record<string, string>,
) {
  const { warehouse_id, mawb, shipment_id, converted_storage_path } = body;

  console.log('[ConvertedManifest] Start', { warehouse_id, mawb, shipment_id, converted_storage_path });

  if (!warehouse_id || !mawb || !shipment_id || !converted_storage_path) {
    return new Response(JSON.stringify({ error: 'Missing required fields: warehouse_id, mawb, shipment_id, converted_storage_path' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1. Find email account by warehouse
  const { data: accounts, error: accErr } = await supabase
    .from('email_accounts')
    .select('id, from_email, from_name, resend_api_key')
    .eq('warehouse_id', warehouse_id)
    .eq('is_default', true)
    .limit(1);

  console.log('[ConvertedManifest] Email account lookup', { found: accounts?.length, error: accErr?.message });

  const account = accounts?.[0];
  if (!account?.resend_api_key) {
    return new Response(JSON.stringify({ error: `No default email account with Resend API key for warehouse ${warehouse_id}` }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Find converted_manifest template
  const { data: templates, error: tplErr } = await supabase
    .from('email_templates')
    .select('subject, body, recipients')
    .eq('template_type', 'converted_manifest')
    .limit(1);

  console.log('[ConvertedManifest] Template lookup', { found: templates?.length, error: tplErr?.message });

  const template = templates?.[0];
  const recipients = template?.recipients;
  if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
    return new Response(JSON.stringify({ error: 'No recipients configured for converted_manifest template' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 3. Generate signed URL for attachment
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('shipment-files')
    .createSignedUrl(converted_storage_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('[ConvertedManifest] Signed URL error', signedUrlError);
    return new Response(JSON.stringify({ error: `Failed to generate signed URL: ${signedUrlError?.message || 'unknown'}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 4. Build email
  const subject = (template?.subject || 'Converted manifest ({{mawb}})')
    .replace(/\{\{mawb\}\}/g, mawb);
  const bodyText = (template?.body || 'Dear customs team,\n\nPlease find attached the converted manifest for shipment {{mawb}}.\n\nKind regards')
    .replace(/\{\{mawb\}\}/g, mawb);
  const htmlBody = bodyText.split('\n').map((line: string) => `<p>${line || '&nbsp;'}</p>`).join('');

  const fromStr = account.from_name
    ? `${account.from_name} <${account.from_email}>`
    : account.from_email;

  const emailPayload = {
    from: fromStr,
    to: Array.isArray(recipients) ? recipients : [recipients],
    subject,
    html: htmlBody,
    attachments: [{
      filename: `${mawb.replace(/\D/g, '')}_customs_converted.xlsx`,
      path: signedUrlData.signedUrl,
    }],
  };

  console.log('[ConvertedManifest] Sending via Resend', { from: fromStr, to: recipients, subject });

  // 5. Send via Resend
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${account.resend_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  const resendData = await resendResponse.json();

  if (!resendResponse.ok) {
    console.error('[ConvertedManifest] Resend API error:', resendData);
    return new Response(JSON.stringify({ error: 'Resend API error', details: resendData }), {
      status: resendResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[ConvertedManifest] ✅ Email sent', { id: resendData.id });

  // 6. Update shipment_files record
  await supabase
    .from('shipment_files')
    .update({ email_sent_at: new Date().toISOString(), email_sent_by: user.email })
    .eq('shipment_id', shipment_id)
    .eq('file_type', 'manifest_converted');

  return new Response(JSON.stringify({ success: true, id: resendData.id }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
