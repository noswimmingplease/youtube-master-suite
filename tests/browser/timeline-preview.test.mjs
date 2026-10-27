import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const BASE = readFileSync(new URL('./watch-page.html', import.meta.url), 'utf8').replace('lang="en"', 'lang="en-GB"');
const KEY = 'yt-master-suite.settings.v1';
const CSS = `<style>
  #movie_player { width: min(100vw - 32px, 1600px); height: 700px; }
  .ytp-progress-bar-container { position:absolute; bottom:40px; left:8px; right:8px; height:16px; z-index:3; }
  .ytp-progress-bar { height:100%; }
  .ytp-tooltip { position:absolute; bottom:70px; left:500px; width:200px; height:150px; z-index:2; }
  .ytp-tooltip-bg { width:200px; height:112px; border-radius:8px;
    background-image:linear-gradient(45deg,red,blue); background-size:1000px 560px; background-position:-400px -224px; }
  .ytp-tooltip-text { height:38px; color:white; background:#222; }
</style>`;
const MARKUP = `<div class="ytp-progress-bar-container"><div class="ytp-progress-bar"></div></div>
  <div class="ytp-tooltip ytp-preview"><div class="ytp-tooltip-bg"></div><div class="ytp-tooltip-text">4:42 Video starts</div></div>`;
const FLOATING_SETUP = `<script>
  const host=document.getElementById('player'), anchor=document.createElement('div');
  anchor.id='single-column-container'; host.before(anchor); anchor.append(host);
  const movie=document.getElementById('movie_player'), chrome=document.createElement('div');
  chrome.className='ytp-chrome-bottom'; chrome.style.cssText='position:absolute;bottom:0;height:56px;width:100%';
  const controls=movie.querySelector('.ytp-right-controls'); controls.style.cssText='position:absolute;bottom:0;right:0';
  chrome.append(movie.querySelector('.ytp-progress-bar-container'),controls); movie.append(chrome);
</script>`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); });
after(async () => { await browser?.close(); });

async function fixture(t, mode = 'auto', viewport = { width: 1920, height: 1080 }, {miniplayer=false}={}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ KEY, mode, miniplayer }) => localStorage.setItem(KEY, JSON.stringify({ version:1,
    values:{ timelinePreviewSize:mode, theatreMode:false, miniplayerEnabled:miniplayer } })), { KEY, mode, miniplayer });
  await page.route('**/*', route => route.request().url().startsWith('https://www.youtube.com/watch?') ?
    route.fulfill({ contentType:'text/html', body:BASE.replace('</head>', CSS + '</head>')
      .replace('<video class="html5-main-video"></video>', '<video class="html5-main-video"></video>' + MARKUP)
      .replace('</body>', `${miniplayer?FLOATING_SETUP:''}<script>${SUITE}</script></body>`) }) : route.abort());
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs:10000, errors });
  return page;
}
async function hover(page) {
  await page.locator('.ytp-progress-bar').hover({timeout:3000});
  await page.waitForTimeout(80);
}
async function geometry(page) {
  return page.evaluate(() => {
    const node = document.querySelector('.ytp-tooltip'), image = node.querySelector('.ytp-tooltip-bg');
    const rect = element => { const r=element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
    return { tip:rect(node), image:rect(image), player:rect(document.getElementById('movie_player')),
      track:rect(document.querySelector('.ytp-progress-bar-container')), scale:node.style.scale,
      nativeWidth:node.style.width, background:getComputedStyle(image).backgroundPosition,
      backgroundSize:getComputedStyle(image).backgroundSize };
  });
}
for (const [mode, expected] of [['auto',320], ['small',240], ['medium',320], ['large',480], ['native',200]]) {
  test(`${mode} preview uses the requested width without altering the storyboard sprite`, async t => {
    const page = await fixture(t, mode); await hover(page);
    const g = await geometry(page);
    assert.ok(Math.abs(g.image.width - expected) < 1, JSON.stringify(g));
    assert.equal(g.background, '-400px -224px'); assert.equal(g.backgroundSize, '1000px 560px');
    assert.equal(g.nativeWidth, '');
    if (mode === 'native') assert.equal(g.scale, '');
  });
}
for (const viewport of [{width:1024,height:768}, {width:2560,height:1440}, {width:3840,height:2160}]) {
  test(`automatic preview fits a ${viewport.width}px viewport and follows player resizing`, async t => {
    const page = await fixture(t, 'auto', viewport); await hover(page);
    const initial = await geometry(page);
    assert.ok(Math.abs(initial.image.width - Math.max(192, Math.min(480, initial.player.width * .2))) < 1);
    await page.evaluate(() => { const p=document.getElementById('movie_player'); p.style.width='400px'; p.style.height='260px'; });
    await hover(page);
    const g = await geometry(page);
    assert.ok(g.tip.left >= g.player.left+7 && g.tip.right <= g.player.right-7, JSON.stringify(g));
    assert.ok(g.tip.top >= g.player.top+7 && g.tip.bottom <= g.track.top-7, JSON.stringify(g));
  });
}
for (const left of [-60, 1490]) {
  test(`preview is clamped at the ${left < 0 ? 'left' : 'right'} timeline edge`, async t => {
    const page = await fixture(t, 'large');
    await page.locator('.ytp-tooltip').evaluate((n,left) => n.style.left=left+'px', left);
    await hover(page); const g=await geometry(page);
    assert.ok(g.tip.left >= g.player.left+7 && g.tip.right <= g.player.right-7, JSON.stringify(g));
    await page.locator('.ytp-tooltip').evaluate(n => n.style.left='400px');
    await page.waitForTimeout(80);
    assert.ok(Math.abs((await geometry(page)).image.width-480)<1);
  });
}
test('preview preserves native inline geometry and restores only its own styles on leave', async t => {
  const page=await fixture(t); await hover(page);
  assert.notEqual((await geometry(page)).scale, '');
  await page.mouse.move(10,10); await page.waitForTimeout(50);
  assert.equal((await geometry(page)).scale, '');
  await hover(page);
  await page.locator('.ytp-tooltip').evaluate(n => n.style.setProperty('scale','1.1','important'));
  await page.waitForTimeout(50); await page.mouse.move(10,10);
  assert.equal((await geometry(page)).scale, '1.1');
});
test('no competing transforms, ordinary text tooltips or precise-seeking surfaces are resized', async t => {
  const page=await fixture(t);
  await page.locator('.ytp-tooltip').evaluate(n => n.style.transform='translateX(3px)');
  await hover(page); assert.equal((await geometry(page)).scale, '');
  await page.mouse.move(10,10);
  await page.locator('.ytp-tooltip').evaluate(n => { n.style.transform=''; n.classList.remove('ytp-preview'); });
  await hover(page); assert.equal((await geometry(page)).scale, '');
});
test('late native preview insertion and viewport changes are handled only during a hover', async t => {
  const page=await fixture(t);
  await page.locator('.ytp-tooltip').evaluate(n => { window.preview=n; n.remove(); });
  await hover(page);
  await page.evaluate(() => document.getElementById('movie_player').append(window.preview));
  await page.waitForFunction(() => document.querySelector('.ytp-tooltip').style.scale !== '');
  await page.setViewportSize({width:1280,height:900}); await hover(page);
  assert.ok(Math.abs((await geometry(page)).image.width-249.6)<1);
  await page.mouse.move(10,10); await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.ownedWrites=0; new MutationObserver(records => { window.ownedWrites+=records.length; })
      .observe(document.querySelector('.ytp-tooltip'), {attributes:true,attributeFilter:['style']});
  });
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.ownedWrites),0);
});
test('navigation and pagehide restore presentation without touching playback', async t => {
  const page=await fixture(t);
  for (const name of ['yt-navigate-start','pagehide']) {
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await hover(page);
    assert.notEqual((await geometry(page)).scale,'');
    const before=await page.locator('video').evaluate(v => ({time:v.currentTime,paused:v.paused,src:v.getAttribute('src')}));
    await page.evaluate(name => window.dispatchEvent(new Event(name)),name);
    assert.equal((await geometry(page)).scale,'');
    assert.deepEqual(await page.locator('video').evaluate(v => ({time:v.currentTime,paused:v.paused,src:v.getAttribute('src')})),before);
    await page.mouse.move(10,10);
  }
});

test('fullscreen layout notifications do not cancel an existing timeline hover', async t => {
  const page=await fixture(t); await hover(page);
  await page.evaluate(()=>document.dispatchEvent(new Event('fullscreenchange')));
  await page.waitForTimeout(80);
  assert.notEqual((await geometry(page)).scale,'');
});
test('Player settings expose the size selector with normal save, revert and defaults behaviour', async t => {
  const page=await fixture(t);
  await page.locator('#ytms-settings-button').click(); await page.locator('#ytms-tab-player').click();
  const control=page.locator('#ytms-timelinePreviewSize');
  assert.equal(await control.inputValue(),'auto');
  await control.selectOption('large'); assert.equal(await page.locator('#ytms-save-preview').isEnabled(),true);
  await control.selectOption('auto'); assert.equal(await page.locator('#ytms-save-preview').isDisabled(),true);
  await control.selectOption('medium'); await page.locator('#ytms-save-preview').click();
  assert.equal(await page.evaluate(KEY=>JSON.parse(localStorage.getItem(KEY)).values.timelinePreviewSize,KEY),'medium');
});

test('transformed scroll players use visible dimensions, not their unscaled layout size', async t => {
  const page=await fixture(t);
  await page.locator('#movie_player').evaluate(n => { n.style.transformOrigin='top left'; n.style.transform='scale(.5)'; });
  await hover(page); const g=await geometry(page);
  assert.ok(Math.abs(g.image.width-192)<1,JSON.stringify(g));
  assert.ok(g.tip.left >= g.player.left+7 && g.tip.right <= g.player.right-7,JSON.stringify(g));
});

test('native sprite dimensions and positioning can change while the preview remains open', async t => {
  const page=await fixture(t); await hover(page);
  await page.locator('.ytp-tooltip-bg').evaluate(n => { n.style.width='160px'; n.style.backgroundPosition='-160px -90px'; });
  await page.locator('.ytp-tooltip').evaluate(n => { n.style.width='160px'; n.style.left='900px'; });
  await page.waitForTimeout(80); const g=await geometry(page);
  assert.ok(Math.abs(g.image.width-320)<1,JSON.stringify(g));
  assert.equal(g.background,'-160px -90px'); assert.equal(g.nativeWidth,'160px');
  await page.mouse.move(10,10); assert.equal((await geometry(page)).nativeWidth,'160px');
});

test('removed players restore owned styles and are not retained as active observers', async t => {
  const page=await fixture(t); await hover(page);
  await page.locator('#movie_player').evaluate(n => { window.oldPlayer=n; n.remove(); });
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>window.oldPlayer.querySelector('.ytp-tooltip').style.scale),'');
});

for (const dark of [true,false]) {
  test(`timeline preview keeps native colours in ${dark?'dark':'light'} mode`, async t => {
    const page=await fixture(t);
    await page.evaluate(dark=>document.documentElement.toggleAttribute('dark',dark),dark);
    const before=await page.locator('.ytp-tooltip-text').evaluate(n=>({colour:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor}));
    await hover(page);
    assert.deepEqual(await page.locator('.ytp-tooltip-text').evaluate(n=>({colour:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})),before);
  });
}

test('entering and exiting real page fullscreen recalculates the preview for the new player area', async t => {
  const page=await fixture(t); await hover(page);
  await page.mouse.move(10,10);
  await page.locator('#page-fullscreen').click();
  await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  await hover(page); const g=await geometry(page);
  assert.ok(Math.abs(g.image.width-Math.max(192,Math.min(480,g.player.width*.2)))<1,JSON.stringify(g));
  assert.ok(g.tip.left>=g.player.left+7 && g.tip.right<=g.player.right-7,JSON.stringify(g));
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.fullscreenElement);
  await hover(page); assert.ok(Math.abs((await geometry(page)).image.width-320)<1);
});

test('native timeline pointer and click handlers still receive their events', async t => {
  const page=await fixture(t);
  await page.evaluate(()=>{
    window.seekEvents=[];
    const track=document.querySelector('.ytp-progress-bar');
    for(const name of ['pointerdown','pointerup','click']) track.addEventListener(name,e=>window.seekEvents.push([name,e.defaultPrevented]));
  });
  await hover(page); await page.locator('.ytp-progress-bar').click();
  assert.deepEqual(await page.evaluate(()=>window.seekEvents),[['pointerdown',false],['pointerup',false],['click',false]]);
});

test('hovering a compact native miniplayer never installs preview sizing there', async t => {
  const page=await fixture(t);
  await page.locator('#movie_player').evaluate(p=>{
    const mini=document.createElement('ytd-miniplayer'); p.replaceWith(mini); mini.append(p);
  });
  await hover(page); assert.equal((await geometry(page)).scale,'');
});

async function floatPlayer(page) {
  await page.mouse.move(10,10);
  await page.evaluate(()=>window.scrollTo(0,900));
  await page.waitForFunction(()=>document.body.classList.contains('ytsmp-scroll-miniplayer-active') &&
    document.getElementById('movie_player')?.parentElement===document.body);
  await hover(page);
}

for (const mode of ['auto','small','medium','large']) {
  test(`${mode} preview is proportionate to the real scroll miniplayer and follows its resizing`, async t=>{
    const page=await fixture(t,mode,{width:1920,height:1080},{miniplayer:true});
    const before=await page.evaluate(KEY=>({settings:localStorage.getItem(KEY),id:fixture.playerId,
      time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused}),KEY);
    await floatPlayer(page);
    const assertFloating=g=>{
      const fraction=({auto:.2,small:.2,medium:320/1200,large:.4})[mode];
      const expected=Math.min(g.player.width*fraction,g.player.height*.45/150*200);
      assert.ok(Math.abs(g.image.width-expected)<1,JSON.stringify(g));
      assert.ok(g.tip.height<=g.player.height*.45+1,JSON.stringify(g));
      assert.ok(g.tip.left>=g.player.left+7 && g.tip.right<=g.player.right-7,JSON.stringify(g));
      assert.ok(g.tip.top>=g.player.top+7 && g.tip.bottom<=g.track.top-7,JSON.stringify(g));
    };
    const original=await geometry(page); assertFloating(original);
    await page.setViewportSize({width:1280,height:900}); await hover(page);
    const smaller=await geometry(page); assertFloating(smaller);
    assert.ok(smaller.player.width<original.player.width);
    assert.ok(smaller.image.width<original.image.width);
    assert.deepEqual(await page.evaluate(KEY=>({settings:localStorage.getItem(KEY),id:fixture.playerId,
      time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused}),KEY),before);
  });
}

test('Large returns to its normal target after leaving the real scroll miniplayer', async t=>{
  const page=await fixture(t,'large',{width:1920,height:1080},{miniplayer:true});
  await hover(page); assert.ok(Math.abs((await geometry(page)).image.width-480)<1);
  await floatPlayer(page); assert.ok((await geometry(page)).image.width<300);
  await page.mouse.move(10,10); await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForFunction(()=>!document.body.classList.contains('ytsmp-scroll-miniplayer-active') &&
    document.getElementById('movie_player')?.parentElement?.id==='player');
  await hover(page); assert.ok(Math.abs((await geometry(page)).image.width-480)<1);
});

test('fullscreen entered from the floating player restores Large and returns to proportionate sizing on exit', async t=>{
  const page=await fixture(t,'large',{width:1920,height:1080},{miniplayer:true});
  await floatPlayer(page);
  await page.locator('.ytp-fullscreen-button').click();
  await page.waitForFunction(()=>document.fullscreenElement?.id==='movie_player' &&
    !document.body.classList.contains('ytsmp-scroll-miniplayer-active'));
  await hover(page); assert.ok(Math.abs((await geometry(page)).image.width-480)<1);
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.fullscreenElement);
  await floatPlayer(page); assert.ok((await geometry(page)).image.width<300);
});

for(const imageHeight of [150,300]) {
  test(`Large floating previews with ${imageHeight}px-tall native images remain below the height limit`,async t=>{
    const page=await fixture(t,'large',{width:1920,height:1080},{miniplayer:true});
    await page.locator('.ytp-tooltip-bg').evaluate((n,h)=>n.style.height=h+'px',imageHeight);
    await page.locator('.ytp-tooltip').evaluate((n,h)=>n.style.height=(h+38)+'px',imageHeight);
    await floatPlayer(page); const g=await geometry(page);
    assert.ok(g.image.width<=g.player.width*.4+1,JSON.stringify(g));
    assert.ok(g.tip.height<=g.player.height*.45+1,JSON.stringify(g));
    assert.ok(g.tip.bottom<=g.track.top-7,JSON.stringify(g));
  });
}

test('YouTube default does not gain floating preview styles',async t=>{
  const page=await fixture(t,'native',{width:1920,height:1080},{miniplayer:true});
  await floatPlayer(page);
  assert.equal((await geometry(page)).scale,'');
});
