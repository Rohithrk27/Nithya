import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rohith.nitya',
  appName: 'Niത്യ',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    url: 'https://my-nithya.vercel.app',
    cleartext: false
  },
  android: {
    studioPath: 'D:\\Android Studio\\bin\\studio64.exe'
  }
};

export default config;
