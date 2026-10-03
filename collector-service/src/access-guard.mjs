export function classifyAccessBlock(diag = {}) {
  let pathname = '';
  try { pathname = new URL(diag.href || 'https://www.facebook.com/').pathname.toLowerCase(); }
  catch {}

  if (/^\/checkpoint(?:\/|$)/.test(pathname)) return { blocked: true, reason: 'checkpoint_url' };
  if (/^\/login(?:\/|$)/.test(pathname) || /\/login\/device-based\//.test(pathname)) return { blocked: true, reason: 'login_url' };
  if (diag.hasCheckpointForm && !diag.hasAdsLibraryMarker) return { blocked: true, reason: 'checkpoint_form' };
  if (diag.hasPasswordInput && diag.hasLoginForm && !diag.hasAdsLibraryMarker) return { blocked: true, reason: 'login_form' };
  return { blocked: false, reason: null };
}
