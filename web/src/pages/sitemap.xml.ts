import type { APIRoute } from 'astro';
import { siteConfig, getCanonicalUrl } from '../config/site';

const publicPages = [
  '',
  '/how-to-send-files-between-phone-and-pc',
  '/how-to-transfer-files-from-iphone-to-windows',
  '/how-to-transfer-files-from-android-to-mac',
  '/share-files-without-uploading',
  '/p2p-file-sharing',
  '/airdrop-alternative',
  '/text-sharing',
  '/clipboard-sharing',
  '/security',
  '/privacy',
  '/docs',
  '/docs/how-it-works',
  '/docs/webrtc',
  '/docs/file-transfer',
  '/docs/troubleshooting',
];

export const GET: APIRoute = async () => {
  const currentDate = new Date().toISOString().split('T')[0];

  const xmlUrls = publicPages
    .map((page) => {
      const priority = page === '' ? '1.0' : '0.8';
      const changeFreq = page === '' ? 'daily' : 'monthly';
      const loc = getCanonicalUrl(page || '/');
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>${changeFreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join('\n');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlUrls}
</urlset>`;

  return new Response(sitemapXml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
