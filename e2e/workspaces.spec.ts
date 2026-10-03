import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('authenticated proxy rejects spoofing and applies independent Redis limits to clients', async ({ request }) => {
  const send = (ip: string, token = 'a'.repeat(64)) => request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3100', 'X-RCS-Request': '1',
      'x-rcs-edge-token': token, 'x-rcs-client-ip': ip, 'x-forwarded-for': '203.0.113.99' },
    data: { email: `${randomUUID()}@example.test`, password: 'wrong-test-password' }
  });
  expect((await send('192.0.2.20', 'c'.repeat(64))).status()).toBe(503);
  expect((await send('192.0.2.20, 192.0.2.21')).status()).toBe(503);
  for (let i = 0; i < 5; i++) expect((await send('192.0.2.20')).status()).toBe(401);
  expect((await send('192.0.2.20')).status()).toBe(429);
  expect((await send('192.0.2.21')).status()).toBe(401);
});

test('register, workspace isolation, workspace switch, logout and login', async ({ page, browser }) => {
  const suffix = randomUUID();
  const email = `alice-${suffix}@example.test`;
  const password = `test-only-${suffix}`;
  const initial = await page.goto('/');
  expect(initial!.headers()).toMatchObject({ 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  expect(initial!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const policy = initial!.headers()['content-security-policy']!;
  const nonce = policy.match(/'nonce-([^']+)'/)![1]!;
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect(await page.locator('script').evaluateAll((scripts) => scripts.map((script) => script.nonce)))
    .toEqual(expect.arrayContaining([nonce]));
  // Inject into the received HTML so Chromium evaluates a parser-inserted script under CSP.
  await page.route('**/login', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('<head>',
      "<head><script>document.documentElement.dataset.injectedScript = 'executed'</script>");
    expect(body).toContain('dataset.injectedScript');
    await route.fulfill({ response, body });
  }, { times: 1 });
  const repeated = await page.goto('/login');
  expect(await page.locator('html').getAttribute('data-injected-script')).toBeNull();
  expect(repeated!.headers()['content-security-policy']).not.toBe(policy);
  expect(initial!.headers()['x-powered-by']).toBeUndefined();
  expect(JSON.stringify(initial!.headers())).not.toContain('a'.repeat(64));
  expect(JSON.stringify(initial!.headers())).not.toContain('b'.repeat(64));
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Criar uma conta' }).click();
  await page.getByLabel('Seu nome').fill('Alice');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Nome do workspace').fill('Equipe Alice');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Confirme a senha').fill(password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await expect(page.getByText('Equipe Alice', { exact: true })).toBeVisible();
  const firstCookies = await page.context().cookies();
  expect(firstCookies.find((cookie) => cookie.name === 'rcs_session')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  const firstWorkspaces = await page.request.get('/api/workspaces');
  const workspaceA = (await firstWorkspaces.json()).workspaces[0].id;

  const bobContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3100',
    extraHTTPHeaders: { 'x-rcs-edge-token': 'a'.repeat(64), 'x-rcs-client-ip': '192.0.2.11' } });
  try {
    const bob = await bobContext.newPage();
    await bob.goto('/register');
    await bob.getByLabel('Seu nome').fill('Bob');
    await bob.getByLabel('E-mail', { exact: true }).fill(`bob-${suffix}@example.test`);
    await bob.getByLabel('Nome do workspace').fill('Equipe Bob');
    await bob.getByLabel('Senha', { exact: true }).fill(password);
    await bob.getByLabel('Confirme a senha').fill(password);
    await bob.getByRole('button', { name: 'Criar conta' }).click();
    await expect(bob).toHaveURL('http://127.0.0.1:3100/');
    const bobWorkspaces = await bob.request.get('/api/workspaces');
    const workspaceB = (await bobWorkspaces.json()).workspaces[0].id;
    expect((await page.request.get(`/api/workspaces/${workspaceB}/context`)).status()).toBe(404);
    expect((await page.request.get(`/api/workspaces/${workspaceB}/audit`)).status()).toBe(404);
    expect((await bob.request.get(`/api/workspaces/${workspaceA}/audit`)).status()).toBe(404);

    const invited = await bob.request.post(`/api/workspaces/${workspaceB}/members`, {
      headers: { Origin: 'http://127.0.0.1:3100', 'X-RCS-Request': '1' }, data: { email, role: 'viewer' }
    });
    expect(invited.status()).toBe(204);
    await page.reload();
    await page.getByRole('combobox').selectOption(workspaceB);
    await expect(page).toHaveURL(new RegExp(`workspace=${workspaceB}`));
    expect((await page.request.get(`/api/workspaces/${workspaceB}/audit`)).status()).toBe(403);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3100/');
  } finally { await bobContext.close(); }
});
