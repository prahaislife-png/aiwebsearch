export interface CaptureInput {
  jobId: string;
  companyName: string;
  country?: string | null;
  urls: {
    sectionKey: string;
    sectionTitle: string;
    url: string;
  }[];
}

export interface CaptureResult {
  sectionKey: string;
  sectionTitle: string;
  sourceUrl: string;
  finalUrl: string;
  pageTitle?: string;
  screenshotUrl?: string;
  screenshotBase64?: string;
  extractedText?: string;
  capturedAt: string;
  status: 'success' | 'failed';
  errorMessage?: string;
}

export interface CaptureProvider {
  capturePages(input: CaptureInput): Promise<CaptureResult[]>;
}
