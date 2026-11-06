import { test as base, type BrowserContext } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { installSignupFixture } from './signup-fixture'

export async function installImageFixture(context: BrowserContext) {
  await installSignupFixture(context)
  if (process.env.FLAT_GIRL_TEST_CDN !== 'true') return
  const root=process.env.FLAT_GIRL_TEST_IMAGE_ROOT
  if (!root) throw new Error('CDN fixture needs FLAT_GIRL_TEST_IMAGE_ROOT')
  await context.route('https://fixture.cloudfront.net/**',async route=>{
    const key=new URL(route.request().url()).pathname.slice(1)
    if(key==='favicon.ico')return route.fulfill({status:204})
    if(!/^variants\/[a-f0-9]{64}\/[a-z0-9-]+\.(webp|png)$/.test(key))return route.fulfill({status:404})
    await route.fulfill({status:200,contentType:key.endsWith('.png')?'image/png':'image/webp',body:await readFile(path.join(root,key))})
  })
}

export const test=base.extend({context:async({context},use)=>{
  await installImageFixture(context)
  await use(context)
}})
