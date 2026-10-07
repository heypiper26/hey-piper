import { createSessionCookie, clearSessionCookie, isAuthenticated, verifyPassword, setPassword, clientIp, checkLoginLock, recordFailedLogin, clearLoginAttempts } from '../../lib/auth.js';

export default async function handler(req, res) {
  const seg = req.query['...path']; const path = seg != null ? [seg] : [];
  const [action] = path;

  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const ip = clientIp(req);
    const lockedSeconds = await checkLoginLock(ip);
    if (lockedSeconds) {
      res.setHeader('Retry-After', String(lockedSeconds));
      return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${Math.ceil(lockedSeconds / 60)} min.` });
    }
    const { password } = req.body || {};
    if (!password || !(await verifyPassword(password))) {
      await recordFailedLogin(ip);
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    await clearLoginAttempts(ip);
    res.setHeader('Set-Cookie', createSessionCookie());
    return res.json({ ok: true });
  }

  if (action === 'change-password') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Não autenticado' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Preencha a senha atual e a nova senha' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
    }
    if (!(await verifyPassword(currentPassword))) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    await setPassword(newPassword);
    res.setHeader('Set-Cookie', createSessionCookie());
    return res.json({ ok: true });
  }

  if (action === 'logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.json({ ok: true });
  }

  if (action === 'check') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return res.json({ authenticated: isAuthenticated(req) });
  }

  res.status(404).json({ error: 'Not found' });
}
