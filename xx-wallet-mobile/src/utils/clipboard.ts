/**
 * copyToClipboard — works on both HTTP and HTTPS.
 *
 * navigator.clipboard.writeText() requires HTTPS (or localhost).
 * When running over plain HTTP on a local network (e.g. http://10.0.0.16:5173),
 * it throws a SecurityError. We fall back to the legacy execCommand approach
 * which works on HTTP but is deprecated on desktop — fine for our use case.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try the modern API first (works on HTTPS / localhost)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy method
    }
  }

  // Legacy fallback — works on HTTP
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Keep off-screen so it doesn't flash
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

/**
 * shareOrCopy — tries Web Share API first, falls back to copy.
 *
 * navigator.share() also requires HTTPS on most browsers.
 * On HTTP we skip straight to copy + show a share sheet manually.
 */
export async function shareOrCopy(opts: {
  title: string;
  text: string;
}): Promise<'shared' | 'copied' | 'failed'> {
  // Try native share (HTTPS only)
  if (navigator.share && window.isSecureContext) {
    try {
      await navigator.share(opts);
      return 'shared';
    } catch (err) {
      // User cancelled — not a failure
      if ((err as Error).name === 'AbortError') return 'failed';
      // Fall through to copy
    }
  }

  // Fall back to copy
  const success = await copyToClipboard(opts.text);
  return success ? 'copied' : 'failed';
}
