export function providerBaseUrl(baseUrl: string, endpoint: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  return clean.endsWith(endpoint) ? clean.slice(0, -endpoint.length) : clean;
}
