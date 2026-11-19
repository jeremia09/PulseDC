import process from 'node:process';

const frontendUrl = new URL(process.env.PULSE_DC_FRONTEND_URL || 'http://127.0.0.1:3000/');
const backendUrl = new URL(process.env.PULSE_DC_BACKEND_URL || 'http://127.0.0.1:5001/');

async function fetchOk(url, label) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${label} is unreachable at ${url.origin}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status} for ${url}`);
  }
  return response;
}

async function main() {
  const healthUrl = new URL('/api/health', backendUrl);
  const [frontendResponse, healthResponse] = await Promise.all([
    fetchOk(frontendUrl, 'Frontend'),
    fetchOk(healthUrl, 'Backend health endpoint')
  ]);

  const html = await frontendResponse.text();
  if (!html.includes('<title>IoT Pulse DC</title>')) {
    throw new Error(`Frontend response at ${frontendUrl} does not look like the PulseDC dashboard.`);
  }

  const health = await healthResponse.json();
  if (health.status !== 'ok') {
    throw new Error(`Backend health endpoint reported status "${health.status ?? 'missing'}".`);
  }

  const localAssets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const rawPath = match[1];
    if (/^(?:https?:|data:|#)/i.test(rawPath)) continue;
    localAssets.add(new URL(rawPath, frontendUrl));
  }

  const assetResults = await Promise.all([...localAssets].map(async assetUrl => {
    await fetchOk(assetUrl, 'Frontend asset');
    return assetUrl.pathname;
  }));

  console.log(`Frontend page: OK (${frontendUrl.origin})`);
  console.log(`Backend health: OK (${healthUrl})`);
  console.log(`Local frontend assets: OK (${assetResults.length} checked)`);
  if (health.groq_configured === false) {
    console.log('Note: Groq is not configured; the dashboard can still run, but AI chat/investigation may use fallback behavior.');
  }
}

main().catch(error => {
  console.error(`PulseDC smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
