export interface SiteConfig {
  siteName: string;
  siteUrl: string;
  tagline: string;
  description: string;
  defaultSocialImage: string;
  author: string;
  twitterHandle: string;
}

export const siteConfig: SiteConfig = {
  siteName: 'SlingShare',
  siteUrl: typeof process !== 'undefined' && process.env?.SITE_URL
    ? process.env.SITE_URL
    : 'https://slingshare.io',
  tagline: 'Fast, Private Peer-to-Peer File & Text Sharing',
  description:
    'Transfer files, text, and clipboard snippets directly between your phone, laptop, and PC. Zero accounts, no cloud uploads, completely direct and encrypted.',
  defaultSocialImage: '/logo.png',
  author: 'SlingShare Team',
  twitterHandle: '@slingshare',
};

export function getCanonicalUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  // Avoid trailing slash inconsistency (strip trailing slash unless root)
  const normalizedPath = cleanPath.length > 1 && cleanPath.endsWith('/')
    ? cleanPath.slice(0, -1)
    : cleanPath;
  return `${siteConfig.siteUrl}${normalizedPath}`;
}

export function getSoftwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: siteConfig.siteName,
    operatingSystem: 'Any (Cross-platform Browser)',
    applicationCategory: 'UtilitiesApplication',
    description: siteConfig.description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    url: `${siteConfig.siteUrl}/app`,
    image: `${siteConfig.siteUrl}${siteConfig.defaultSocialImage}`,
  };
}

export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteConfig.siteName,
    url: siteConfig.siteUrl,
    logo: `${siteConfig.siteUrl}${siteConfig.defaultSocialImage}`,
    description: siteConfig.description,
  };
}

export function getBreadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: getCanonicalUrl(item.path),
    })),
  };
}

export function getArticleSchema(title: string, description: string, path: string, datePublished = '2026-01-15') {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: description,
    author: {
      '@type': 'Organization',
      name: siteConfig.siteName,
      url: siteConfig.siteUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.siteName,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.siteUrl}${siteConfig.defaultSocialImage}`,
      },
    },
    datePublished: datePublished,
    mainEntityOfPage: getCanonicalUrl(path),
  };
}
