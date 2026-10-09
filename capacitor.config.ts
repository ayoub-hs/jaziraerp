import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jazira.erp',
  appName: 'JaziraERP',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
