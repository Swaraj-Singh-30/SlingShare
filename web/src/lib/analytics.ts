/**
 * Privacy-first analytics helper for SlingShare.
 * Strictly avoids logging user content, file names, room codes, device IDs, or IP addresses.
 * Only tracks high-level product actions when Google Analytics 4 (gtag) is configured.
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export function trackEvent(eventName: string, params: Record<string, any> = {}) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    try {
      window.gtag('event', eventName, params);
    } catch {
      // Gracefully ignore tracking errors
    }
  }
}
