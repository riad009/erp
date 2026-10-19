/** @type {import('next').NextConfig} */
const nextConfig = {
  // the app lives in public/khata/index.html for now (step 1 of the move to Next.js)
  async redirects() {
    return [{ source: '/khata', destination: '/khata/index.html', permanent: false }];
  },
};
export default nextConfig;
