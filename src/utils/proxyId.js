// ─────────────────────────────────────────────
// src/utils/proxyId.js
// Extract proxy ID from the last URL path segment
// ─────────────────────────────────────────────

/**
 * Extracts the proxy ID from a URL.
 * e.g. "https://proxy-provider.example/proxy/px-101" → "px-101"
 */
function extractProxyId(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || url;
  } catch {
    // Fallback: split by '/' and take last segment
    const segments = url.split('/').filter(Boolean);
    return segments[segments.length - 1] || url;
  }
}

module.exports = { extractProxyId };
