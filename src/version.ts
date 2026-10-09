export const CLIENT_VERSION = '1.0.0';
export const CLIENT_BUILD_ID = (import.meta as any).env?.VITE_BUILD_ID || `build-${CLIENT_VERSION}`;
