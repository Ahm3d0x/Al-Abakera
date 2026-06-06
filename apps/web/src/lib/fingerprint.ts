export function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') return 'df_server';
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    screen.width || 0,
    screen.height || 0,
    screen.colorDepth || 0,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || '',
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory || '',
  ];
  const str = parts.join('|||');
  
  // Djb2 Hash algorithm
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return 'df_' + Math.abs(hash).toString(36);
}
