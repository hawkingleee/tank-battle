/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/tank-battle",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
