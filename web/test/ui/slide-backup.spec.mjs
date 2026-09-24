import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) test(`Slide client and one-click backup from Fleet at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:960});
  await page.context().addCookies([{name:'speck-gallery', value:'1', url:'http://127.0.0.1:8761'}]);
  const resource = {id:'a_primary', name:'Clinic workstation', provider:'slide', kind:'protected', connection_id:'slide-settings', connection_name:'Slide (Settings)', node:'Clinic box'};
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const result = await (await route.fetch()).json();
    const endpoint = {...result.machines[0], label:resource.name, client_name:'Primary Clinic', has_endpoint_agent:true, resources:[resource], identity_evidence:['Slide agent ID']};
    await route.fulfill({json:{machines:[endpoint], connections:[]}});
  });
  const requests = [];
  await page.route('**/api/infrastructure/connections/slide-settings/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/catalog')) return route.fulfill({json:{backup:{label:'Back up machine', method:'POST', fields:[], requires_confirmation:false}}});
    if (url.pathname.includes('/resources/')) return route.fulfill({json:{resource, configuration:{hostname:resource.name}}});
    if (url.pathname.endsWith('/actions')) {
      requests.push(route.request().postDataJSON());
      // Simulate a lost receipt after the server accepted the first request.
      if (requests.length === 1) return route.fulfill({status:502, json:{detail:'Response interrupted. Retry to check this request.'}});
      return route.fulfill({json:{status:'submitted', result:{backup_id:'b_requested'}}});
    }
    throw new Error('Unexpected request: ' + url.pathname);
  });
  await page.goto('/');
  await expect(page.locator('#fleet-rows')).toContainText('Primary Clinic');
  await page.locator('#fleet-rows .machine-name').click();
  await expect(page.locator('#machine-details')).toContainText('Primary Clinic');
  // Phones collapse identity (and its provider links) behind Details.
  if (width <= 760) await page.locator('#machine-more').click();
  await page.getByRole('button', {name:'slide · protected a_primary'}).click();
  await page.getByRole('button', {name:'Back up machine', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Back up machine', exact:true});
  await expect(dialog.locator('input[name=confirmation]')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('Response interrupted');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({operation:'backup', kind:'protected', resource_id:'a_primary', args:{}, confirmation:''});
  await dialog.getByRole('button', {name:'Back up machine', exact:true}).click();
  await expect(dialog.getByRole('heading', {name:'submitted'})).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].request_id).toBe(requests[0].request_id);
  await expect(dialog.getByRole('button', {name:'Back up machine', exact:true})).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`slide-backup-${width}.png`), fullPage:true});
});
