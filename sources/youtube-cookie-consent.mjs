// Click YouTube's own optional-cookie rejection action. Never fabricate consent
// cookies or block the essential cookies used for sign-in and playback.
export function rejectYouTubeOptionalCookies(window, document, options = {}) {
  const idle = { stop() {}, get status() { return "not-applicable"; } };
  if (window.location.protocol !== "https:" || window.top !== window ||
      !["www.youtube.com", "consent.youtube.com"].includes(window.location.hostname)) return idle;

  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 250;
  let status = "waiting", timer = null, deadline = null;
  const stop = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (deadline !== null) window.clearTimeout(deadline);
    timer = deadline = null;
    window.removeEventListener("pagehide", stop);
    document.removeEventListener("DOMContentLoaded", check);
    if (status === "waiting") status = "stopped";
  };
  const visible = element => {
    if (!element.isConnected || element.closest("[hidden], [inert]")) return false;
    if (typeof element.checkVisibility === "function" &&
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" &&
      [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  };
  function check() {
    if (status !== "waiting") return;
    const scopes = window.location.hostname === "www.youtube.com"
      ? [...document.querySelectorAll("ytd-consent-bump-v2-lightbox, ytd-consent-bump-lightbox")]
      : document.body && [...document.querySelectorAll("h1, h2, [role=heading]")].some(
          heading => visible(heading) && /^Before you continue to YouTube$/i.test(heading.textContent.trim()))
        ? [document.body] : [];
    // YouTube's lightbox is an inline custom element with a zero-sized box;
    // its actual buttons are laid out inside the dialog. Validate those buttons
    // rather than assuming the wrapper itself has visible geometry.
    const candidates = [...new Set(scopes.filter(scope => scope.isConnected)
      .flatMap(scope => [...scope.querySelectorAll("button")]))]
      .filter(button => {
        const label = button.textContent.replace(/\s+/g, " ").trim();
        const aria = (button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        return visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" &&
          label === "Reject all" && ["", "Reject all",
            "Reject the use of cookies and other data for the purposes described"].includes(aria);
      });
    if (candidates.length === 1) {
      // Mark the attempt and clear every timer before invoking the native UI.
      // An ignored/failed click must never cause repeated submissions.
      status = "rejection-requested";
      stop();
      try { candidates[0].click(); }
      catch { status = "action-failed"; }
      return;
    }
    if (candidates.length > 1) {
      status = "ambiguous";
      stop();
      return;
    }
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(check, intervalMs);
  }
  window.addEventListener("pagehide", stop, { once: true });
  document.addEventListener("DOMContentLoaded", check, { once: true });
  deadline = window.setTimeout(() => { status = "timed-out"; stop(); }, timeoutMs);
  check();
  return { stop, get status() { return status; } };
}
