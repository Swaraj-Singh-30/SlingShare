export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'laptop' | 'phone' | 'tablet';
}

const STORAGE_KEY_ID = 'slingshare_device_id';
const STORAGE_KEY_NAME = 'slingshare_device_name';

/**
 * Gets or creates a persistent, random deviceId.
 * Does NOT use IP, MAC address, hardware serial, or browser fingerprinting.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'server-device-id';
  }

  let id = localStorage.getItem(STORAGE_KEY_ID);
  if (id && id.trim().length >= 8 && id.trim().length <= 64) {
    return id.trim();
  }

  // Generate random 16-byte hex ID
  const randomBytes = new Uint8Array(12);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 12; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  id = 'dev_' + Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(STORAGE_KEY_ID, id);
  return id;
}

/**
 * Detects device hardware form factor and returns a sensible default name.
 */
export function detectDevice(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      deviceId: 'server-id',
      deviceName: 'Web Device',
      deviceType: 'desktop',
    };
  }

  const deviceId = getDeviceId();
  const ua = navigator.userAgent;
  let type: 'desktop' | 'laptop' | 'phone' | 'tablet' = 'desktop';
  let defaultPrefix = 'Device';

  const isMobile = /Mobile|Android|iPhone|iPod/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isTablet) {
    type = 'tablet';
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      defaultPrefix = 'iPad';
    } else {
      defaultPrefix = 'Android Tablet';
    }
  } else if (isMobile) {
    type = 'phone';
    if (/iPhone/i.test(ua)) {
      defaultPrefix = 'iPhone';
    } else if (/Pixel/i.test(ua)) {
      defaultPrefix = 'Google Pixel';
    } else if (/Samsung|SM-/i.test(ua)) {
      defaultPrefix = 'Samsung Galaxy';
    } else {
      defaultPrefix = 'Android Phone';
    }
  } else {
    // Desktop / Laptop
    if (/Macintosh|Mac OS X/i.test(ua)) {
      defaultPrefix = 'MacBook';
      type = 'laptop';
    } else if (/Windows/i.test(ua)) {
      defaultPrefix = 'Windows PC';
      type = 'desktop';
    } else if (/Linux/i.test(ua)) {
      defaultPrefix = 'Linux Workstation';
      type = 'desktop';
    } else if (/CrOS/i.test(ua)) {
      defaultPrefix = 'Chromebook';
      type = 'laptop';
    }
  }

  // Check localStorage for saved custom name
  const savedName = localStorage.getItem(STORAGE_KEY_NAME);
  if (savedName && savedName.trim()) {
    const validated = validateDeviceName(savedName);
    if (validated) {
      return { deviceId, deviceName: validated, deviceType: type };
    }
  }

  // Generate a friendly suffix on first launch
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const friendlyName = `${defaultPrefix}-${randomSuffix}`;
  localStorage.setItem(STORAGE_KEY_NAME, friendlyName);

  return { deviceId, deviceName: friendlyName, deviceType: type };
}

export interface DeviceNameValidation {
  valid: boolean;
  name: string;
  error?: string;
}

/**
 * Validates a device name string:
 * - 1 to 40 characters
 * - Trimmed whitespace
 * - Strips control characters
 */
export function validateDeviceName(rawName: string): string | null {
  if (!rawName) return null;
  // Replace control characters and trim
  const clean = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (clean.length < 1 || clean.length > 40) {
    return null;
  }
  return clean;
}

/**
 * Returns structured validation result with human-friendly error messages.
 */
export function validateDeviceNameResult(rawName: string): DeviceNameValidation {
  if (!rawName || !rawName.trim()) {
    return { valid: false, name: '', error: 'Device name cannot be empty.' };
  }
  const clean = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (clean.length < 1) {
    return { valid: false, name: '', error: 'Device name cannot be empty.' };
  }
  if (clean.length > 40) {
    return { valid: false, name: '', error: 'Device name must be 40 characters or fewer.' };
  }
  return { valid: true, name: clean };
}

/**
 * Saves and validates a custom device name.
 * Returns the sanitized name if valid, or null if invalid.
 */
export function saveCustomDeviceName(name: string): string | null {
  const result = validateDeviceNameResult(name);
  if (!result.valid) return null;

  localStorage.setItem(STORAGE_KEY_NAME, result.name);
  return result.name;
}
