/** @type {import('next').NextConfig} */
const nextConfig = {
  // the app lives in public/khata/index.html for now (step 1 of the move to Next.js)
  // phones (and in-app browsers) must always load the newest app, never an old saved copy
  async headers() {
    return [{ source: '/khata/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] }];
  },
  async redirects() {
    return [{ source: '/khata', destination: '/khata/index.html', permanent: false }];
  },
};
export default nextConfig;
