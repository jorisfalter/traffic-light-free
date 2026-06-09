import type { CapacitorConfig } from '@capacitor/cli';

const liveReloadUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.jorisfalter.lightlessbike',
  appName: 'Lightless Bike',
  webDir: 'dist',
  plugins: {
    // Route fetch()/XHR through native networking so external API calls
    // (Overpass, Nominatim) bypass WKWebView CORS/networking limits.
    CapacitorHttp: {
      enabled: true,
    },
  },
  ...(liveReloadUrl
    ? {
        server: {
          url: liveReloadUrl,
          cleartext: true,
        },
      }
    : {}),
};

export default config;
