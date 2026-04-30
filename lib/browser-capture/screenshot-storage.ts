import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET_NAME = 'screenshots';

let bucketEnsured = false;

async function ensureBucket() {
  if (bucketEnsured) return;
  const admin = createAdminClient();
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    await admin.storage.createBucket(BUCKET_NAME, { public: true });
  }
  bucketEnsured = true;
}

function slugifyPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? 'homepage' : u.pathname.replace(/^\//, '').replace(/\//g, '_');
    return path.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 80) || 'page';
  } catch {
    return 'page';
  }
}

export async function uploadScreenshot(
  jobId: string,
  pageUrl: string,
  screenshotBuffer: Buffer
): Promise<string | undefined> {
  try {
    await ensureBucket();
    const admin = createAdminClient();
    const slug = slugifyPath(pageUrl);
    const filePath = `${jobId}/${slug}.png`;

    const { error } = await admin.storage
      .from(BUCKET_NAME)
      .upload(filePath, screenshotBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      console.warn(`[ScreenshotStorage] Upload failed for ${pageUrl}:`, error.message);
      return undefined;
    }

    const { data } = admin.storage.from(BUCKET_NAME).getPublicUrl(filePath);
    return data.publicUrl;
  } catch (err) {
    console.warn(`[ScreenshotStorage] Upload error for ${pageUrl}:`, err);
    return undefined;
  }
}
