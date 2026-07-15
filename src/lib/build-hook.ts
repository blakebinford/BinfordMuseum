/**
 * Fires the Netlify build hook so the prerendered public site is rebuilt
 * after publishing changes in the admin. Tolerant by design: a missing hook
 * URL logs a warning (content is still saved; the site simply won't rebuild
 * until the hook is configured or the next deploy).
 */
export async function fireBuildHook(reason: string): Promise<{ fired: boolean; detail: string }> {
  const url = process.env.BUILD_HOOK_URL;
  if (!url) {
    console.warn('[build-hook] BUILD_HOOK_URL is not set; public site not rebuilt.');
    return { fired: false, detail: 'BUILD_HOOK_URL is not configured' };
  }
  try {
    const hook = new URL(url);
    hook.searchParams.set('trigger_title', reason);
    const res = await fetch(hook, { method: 'POST', body: '{}' });
    if (!res.ok) {
      console.error(`[build-hook] hook returned ${res.status}`);
      return { fired: false, detail: `Build hook returned ${res.status}` };
    }
    return { fired: true, detail: 'Rebuild triggered' };
  } catch (err) {
    console.error('[build-hook] failed:', err);
    return { fired: false, detail: 'Build hook request failed' };
  }
}
