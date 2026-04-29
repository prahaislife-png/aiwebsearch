import { CaptureProvider, CaptureInput, CaptureResult } from './capture-provider';

export class MockCaptureProvider implements CaptureProvider {
  async capturePages(input: CaptureInput): Promise<CaptureResult[]> {
    console.log(`[MockCapture] Capturing ${input.urls.length} pages for job ${input.jobId}`);

    return input.urls.map((u) => ({
      sectionKey: u.sectionKey,
      sectionTitle: u.sectionTitle,
      sourceUrl: u.url,
      finalUrl: u.url,
      pageTitle: `Mock Page - ${u.sectionTitle}`,
      extractedText: `This is mock extracted text for ${u.url}. Configure APIFY_TOKEN for real captures.`,
      capturedAt: new Date().toISOString(),
      status: 'success' as const,
    }));
  }
}
