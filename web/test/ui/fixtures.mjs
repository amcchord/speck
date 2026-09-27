import {test as base,expect} from '@playwright/test';
// Exercise tile loading/layout without automated traffic to community map servers.
export const test=base.extend({page:async({page},use)=>{
 await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef3ed"/><path d="M0 120H256 M128 0V256" stroke="#fff" stroke-width="5"/><path d="M0 120H256 M128 0V256" stroke="#d6dfd1" fill="none"/></svg>'}));
 await use(page);
}});
export {expect};
