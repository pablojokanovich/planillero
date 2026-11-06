import { createClient } from 'npm:@supabase/supabase-js@2';
import { sharedAccessLogin } from '../_shared/shared-access.mjs';

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const origins = (Deno.env.get('APP_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!url || !serviceKey || !publicKey) return Response.json({ error: 'Access not installed' }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return sharedAccessLogin(request, {
    origins,
    async consumeAttempt(kind: string, req: Request) {
      // Both an IP bucket and a global role bucket limit attempts, even if a client spoofs IP headers.
      const ip = req.headers.get('x-forwarded-for') || 'unknown';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
      const fingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      for (const [scope, limit] of [[`role:${kind}`, 30], [`client:${kind}:${fingerprint}`, 5]] as const) {
        const { data, error } = await admin.rpc('consume_app_login_attempt', { p_scope: scope, p_limit: limit });
        if (error) throw error;
        if (!data) return false;
      }
      return true;
    },
    async credentials(kind: string) {
      const { data, error } = await admin.from('app_access_credentials').select('email,salt,password_hash,iterations').eq('role', kind).maybeSingle();
      if (error) throw error;
      return data;
    },
    async session(email: string) {
      const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (error) throw error;
      const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error: verifyError } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' });
      if (verifyError || !data.session) throw verifyError || new Error('No session');
      return { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in };
    }
  });
});
