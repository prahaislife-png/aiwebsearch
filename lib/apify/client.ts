import { ApifyClient } from 'apify-client';

let client: ApifyClient | null = null;

export function getApifyClient(): ApifyClient {
  if (!client) {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    client = new ApifyClient({ token });
  }
  return client;
}
