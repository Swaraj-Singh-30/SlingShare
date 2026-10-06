export function detectDevice(): { deviceName: string; deviceType: 'desktop' | 'laptop' | 'phone' | 'tablet' } {
  if (typeof window === 'undefined') {
    return { deviceName: 'Web Device', deviceType: 'desktop' };
  }

  const ua = navigator.userAgent;
  let type: 'desktop' | 'laptop' | 'phone' | 'tablet' = 'desktop';
  let name = 'Device';

  const isMobile = /Mobile|Android|iPhone|iPod/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isTablet) {
    type = 'tablet';
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      name = 'iPad';
    } else {
      name = 'Android Tablet';
    }
  } else if (isMobile) {
    type = 'phone';
    if (/iPhone/i.test(ua)) {
      name = 'iPhone';
    } else if (/Pixel/i.test(ua)) {
      name = 'Google Pixel';
    } else if (/Samsung|SM-/i.test(ua)) {
      name = 'Samsung Galaxy';
    } else {
      name = 'Android Phone';
    }
  } else {
    // Desktop / Laptop
    if (/Macintosh|Mac OS X/i.test(ua)) {
      name = 'MacBook';
      type = 'laptop';
    } else if (/Windows/i.test(ua)) {
      name = 'Windows PC';
      type = 'desktop';
    } else if (/Linux/i.test(ua)) {
      name = 'Linux Workstation';
      type = 'desktop';
    } else if (/CrOS/i.test(ua)) {
      name = 'Chromebook';
      type = 'laptop';
    }
  }

  // Check localStorage for saved custom name
  const saved = localStorage.getItem('slingshare_device_name');
  if (saved && saved.trim()) {
    return { deviceName: saved.trim(), deviceType: type };
  }

  // Generate a friendly suffix
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const friendlyName = `${name}-${randomSuffix}`;
  localStorage.setItem('slingshare_device_name', friendlyName);

  return { deviceName: friendlyName, deviceType: type };
}

export function saveCustomDeviceName(name: string): string {
  const trimmed = name.trim().slice(0, 32);
  if (trimmed) {
    localStorage.setItem('slingshare_device_name', trimmed);
    return trimmed;
  }
  return '';
}
