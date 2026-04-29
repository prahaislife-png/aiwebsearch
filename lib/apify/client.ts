const APIFY_BASE_URL = 'https://api.apify.com/v2';

function getToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is not configured');
  return token;
}

function normalizeActorId(actorId: string): string {
  return actorId.replace('/', '~');
}

export async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  options?: { waitSecs?: number; memory?: number }
): Promise<{ defaultDatasetId: string; status: string }> {
  const token = getToken();
  const params = new URLSearchParams();
  if (options?.waitSecs) params.set('waitForFinish', String(options.waitSecs));
  if (options?.memory) params.set('memory', String(options.memory));

  const res = await fetch(
    `${APIFY_BASE_URL}/acts/${normalizeActorId(actorId)}/runs?${params}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify actor run failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    defaultDatasetId: data.data.defaultDatasetId,
    status: data.data.status,
  };
}

export async function getDatasetItems(datasetId: string): Promise<unknown[]> {
  const token = getToken();

  const res = await fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?format=json`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify dataset fetch failed (${res.status}): ${text}`);
  }

  return await res.json();
}

export async function waitForRun(
  runId: string,
  actorId: string,
  timeoutMs: number = 300000
): Promise<{ defaultDatasetId: string; status: string }> {
  const token = getToken();
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(
      `${APIFY_BASE_URL}/acts/${normalizeActorId(actorId)}/runs/${runId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) throw new Error(`Failed to check run status: ${res.status}`);

    const data = await res.json();
    const status = data.data.status;

    if (status === 'SUCCEEDED') {
      return { defaultDatasetId: data.data.defaultDatasetId, status };
    }
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error('Apify run timed out');
}
