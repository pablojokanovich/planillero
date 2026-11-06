export function mailConfigured(env) {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.from || '')) return false;
  const provider = env.provider || 'resend';
  if (provider === 'microsoft365') return Boolean(env.microsoftTenantId && env.microsoftClientId && env.microsoftClientSecret);
  return provider === 'resend' && Boolean(env.resendKey);
}

export function createMailSender(env, fetcher) {
  const provider = env.provider || 'resend';
  let tokenPromise;
  async function microsoftToken() {
    const response = await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(env.microsoftTenantId)}/oauth2/v2.0/token`, {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.microsoftClientId, client_secret: env.microsoftClientSecret,
        scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString()
    });
    if (!response.ok) throw new Error('Microsoft authorization failed');
    const result = await response.json();
    if (!result.access_token) throw new Error('Microsoft returned no access token');
    return result.access_token;
  }
  return async (recipient, message, key) => {
    if (provider === 'microsoft365') {
      const token = await (tokenPromise ||= microsoftToken());
      const response = await fetcher(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.from)}/sendMail`, {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { subject: message.subject, body: { contentType: 'Text', content: message.text },
          toRecipients: [{ emailAddress: { address: recipient.email } }] }, saveToSentItems: true })
      });
      if (response.status !== 202) throw new Error('Microsoft did not accept the message');
      // Graph returns an empty 202 response, not a message id or delivery receipt.
      return `microsoft365:accepted:${key}`;
    }
    if (provider !== 'resend') throw new Error('Unsupported email provider');
    const response = await fetcher('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(10000), headers: {
      Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key
    }, body: JSON.stringify({ from: env.from, to: [recipient.email], ...message }) });
    if (!response.ok) throw new Error('Provider request failed');
    const result = await response.json();
    if (!result.id) throw new Error('Provider returned no message id');
    return result.id;
  };
}
