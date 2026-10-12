import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/lab', '/docs'].map((p) => ({ url: `${SITE.url}${p === '/' ? '' : p}`, changeFrequency: 'weekly', priority: p === '/' ? 1 : 0.8 }));
}
