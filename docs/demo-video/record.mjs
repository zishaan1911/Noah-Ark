// Records the Noah's Ark demo, one clip per segment: node record.mjs <segment...>
// Chrome runs fullscreen (kiosk) on :0 and ffmpeg grabs the screen; the overlay (overlay.js) draws captions and rings.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'clips/';
const ADB = process.env.ADB ?? 'adb'; // from `nix develop .#mobile`
const PARTYROCK = "https://partyrock.aws/u/iamzishaan/hJn7bk5DlUb9/Noah's-Ark%253A-Rescue-and-Delivery-Drone-Fleet";
const DASH = 'http://localhost:5173/';
const STAGE = 'http://localhost:8099/';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });

let page;
const ov = (fn, ...args) => page.evaluate(([fn, args]) => window.__ov?.[fn](...args), [fn, args]);
const cap = (t, s = '', tag = '') => ov('cap', t, s, tag);
const chip = async (n, t) => { await ov('chip', n, t); setTimeout(() => ov('chip', n, '').catch(() => {}), 6000); };
const unring = () => ov('ring', null);
async function ring(loc, label = '', side = 'right') {
  const b = await loc.first().boundingBox();
  if (b) await ov('ring', b, label, side);
}
async function rect(r, label = '', side = 'right') {
  await ov('ring', r, label, side);
}
async function move(x, y) {
  await page.mouse.move(x, y, { steps: 30 });
}
async function click(loc) {
  const l = loc.first();
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const b = await l.boundingBox();
  await move(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(250);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
}
async function smoothScroll(to, ms) {
  await page.evaluate(([to, ms]) => new Promise((done) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const from = scrollY, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      scrollTo(0, from + (to - from) * e);
      k < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  }), [to, ms]);
}

// --- screen capture -----------------------------------------------------------------------------------------------
let ff, recT0 = 0;
function recStart(name) {
  recT0 = Date.now();
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', '3072x1728', '-draw_mouse', '0',
    '-i', ':0.0', '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    OUT + name + '.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
}
async function recStop() {
  const done = new Promise((r) => ff.on('exit', r));
  ff.stdin.write('q'); await done;
}

// --- segments ------------------------------------------------------------------------------------------------------
const S = {};

S.intro = async () => {
  await page.goto(STAGE + 'regions.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  await ov('card', `<div><h1>Noah's <span>Ark</span></h1><p>An amphibious, all-weather delivery drone with an AI brain on AWS.</p><div class="k">When the waters rise, the Ark still delivers</div></div>`);
  await ov('cursor', false);
  recStart('01-intro');
  await sleep(4500);
  await ov('card', '');
  await cap('Who we built it for', 'Three groups of people Malaysia’s roads and boats don’t reach in time');
  await sleep(3500);
  await page.evaluate(() => window.__fly([102.4, 5.0], 6.4));
  await cap('Families cut off by monsoon floods', 'East coast every November to January: rooftops, schools-turned-shelters, villages under water', 'Disaster relief');
  await sleep(1800); await page.evaluate(() => window.__show('flood'));
  await sleep(4500);
  await page.evaluate(() => { window.__hideLabels(); window.__fly([116.1, 5.4], 7.2); });
  await cap('Flood-prone kampungs in Sabah', 'Beaufort and Kota Belud: the places our SOS demo comes from', 'Disaster relief');
  await sleep(1800); await page.evaluate(() => { window.__show('flood', false); window.__show('sabah'); });
  await sleep(4200);
  await page.evaluate(() => { window.__hideLabels(); window.__fly([115.2, 4.2], 6.3); });
  await cap('Interior communities of Sabah & Sarawak', 'Longhouse villages where a GDEX parcel takes days by road and river', 'GDEX last mile');
  await sleep(1800); await page.evaluate(() => { window.__show('sabah', false); window.__show('gdex'); window.__show('sarawak'); });
  await sleep(4500);
  await page.evaluate(() => { window.__hideLabels(); window.__fly([117.4, 5.1], 7.0); });
  await cap('Frontline posts in east Sabah', 'Malaysian Armed Forces resupply in the ESSZONE, without sending a convoy', 'Defence logistics');
  await sleep(1800); await page.evaluate(() => { window.__show('gdex', false); window.__show('sarawak', false); window.__show('mil'); });
  await sleep(4500);
  await page.evaluate(() => { window.__hideLabels(); window.__fly([109.5, 4.2], 5.2); });
  await cap('One fleet, three missions', 'Every mission carries a mode: gdex · relief · military');
  await sleep(4500);
  await recStop();
};

S.landing = async () => {
  await page.goto('http://localhost:8000/');
  await page.waitForTimeout(5000);
  recStart('02-landing');
  await chip('1', 'Landing page · GDEX × Noah’s Ark');
  await ov('cursor', false);
  await cap('The pitch page for GDEX', 'Plain HTML, scroll-driven: from the port to the last mile');
  await sleep(2500);
  await smoothScroll(3000, 7000);
  await cap('GDEX already moves containers and trucks', 'The last 20 km into the interior is where parcels stall');
  await smoothScroll(5860, 6000);
  await cap('ARK-001 flies a GDEX parcel 20 km over the rainforest', 'It drops it at a longhouse village and flies home', 'GDEX last mile');
  await smoothScroll(11700, 22000);
  await sleep(1500);
  const concept = await page.evaluate(() => document.getElementById('concept').getBoundingClientRect().top + scrollY);
  await cap('How it works', 'Flies in rain, lands on water, offloads heavy AI to AWS');
  await smoothScroll(concept, 3000); await sleep(4000);
  const drone = await page.evaluate(() => document.querySelector('section#drone').getBoundingClientRect().top + scrollY);
  await cap('Ark-1: the drone', 'Designed and simulated to a buildable level of detail');
  await smoothScroll(drone, 3000); await sleep(4000);
  const apps = await page.evaluate(() => document.getElementById('apps').getBoundingClientRect().top + scrollY);
  await cap('Three ways in', 'Ark Command for operators · Ark SOS on PartyRock · Ark SOS for Android');
  await smoothScroll(apps, 3000); await sleep(5000);
  await recStop();
};

S.partyrock = async () => {
  await page.goto(PARTYROCK);
  await page.waitForTimeout(8000);
  await page.getByRole('button', { name: 'Decline' }).click({ timeout: 2000 }).catch(() => {});
  recStart('03-partyrock');
  await chip('2', 'Ark SOS on PartyRock · Amazon Bedrock');
  await cap('Ask for help in any language, from any browser', 'A neighbour, a village head or a relative abroad. No app to install', 'Relief · built on PartyRock');
  await sleep(4000);
  const msg = page.getByRole('textbox', { name: 'Message' });
  await ring(msg, 'Malay: “Water up to the roof. 5 of us, a 6-month-old baby, grandma is diabetic and out of insulin.”', 'below');
  await sleep(5500);
  await ring(page.getByRole('textbox', { name: 'Where' }), 'Kampung Tempasuk, Kota Belud, Sabah', 'below');
  await sleep(3500);
  await unring();
  await cap('Bedrock triages the message', 'Urgency, people at risk, needs and a 2 kg relief kit');
  await click(page.getByRole('button', { name: 'Play' }).first());
  await sleep(2000);
  await move(1400, 700);
  // wait for Bedrock to finish (the placeholder text disappears)
  await page.waitForFunction(() => !document.body.innerText.includes("You're all set to"), null, { timeout: 90000 }).catch(() => {});
  await sleep(5000);
  const box = async (name) => {
    const t = await page.getByText(name, { exact: true }).first().boundingBox();
    const m = await page.getByRole('textbox', { name: 'Message' }).boundingBox();
    const w = await page.getByRole('textbox', { name: 'Where' }).boundingBox(), vw = await page.evaluate(() => innerWidth);
    const x = m.x - 8, right = m.x + 2 * (w.x - m.x) + m.width + 8; // the widgets span the same columns as the input row, centred
    return { x, y: t.y - 14, width: right - x, height: name === 'Reply to sender' ? 200 : 180 * vw / 1920 };
  };
  await rect(await box('Triage'), 'Urgency, mode, people at risk and medical needs, read from a Malay message', 'above');
  await cap('Triage in seconds', 'Urgency, who is at risk, what they need, which medicine', 'Amazon Bedrock');
  await sleep(8000);
  await rect(await box('SOS for Ark Command'), 'A machine-readable SOS, same JSON schema as the phone app and backend', 'above');
  await cap('A structured SOS for Ark Command', 'Validated against the shared schema before it can drive a flight');
  await sleep(7000);
  await unring();
  await page.getByText('Reply to sender', { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await sleep(1500);
  await rect(await box('Reply to sender'), 'Replies in Malay with what to do until the drone arrives', 'below');
  await cap('A calm reply, in their own language', 'Safety advice while the drone is arranged');
  await sleep(7000);
  await unring();
  await recStop();
};

// Records the phone itself (adb screenrecord) while driving it; the stage segment shows it later.
S.phone = async () => {
  execFileSync('wmctrl', ['-a', 'Android Emulator']);
  adb('shell', 'am', 'start', '-n', 'com.noahark.arksos/.MainActivity');
  await sleep(2500);
  const [gx, gy, gw, gh] = execFileSync('sh', ['-c', "xwininfo -name 'Android Emulator - ark-sos:5554' | awk '/Absolute upper-left X/{x=$4}/Absolute upper-left Y/{y=$4}/Width/{w=$2}/Height/{h=$2}END{print x, y, w, h}'"], { encoding: 'utf8' }).trim().split(' ');
  const rec = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', `${gw}x${gh}`, '-draw_mouse', '0',
    '-i', `:0.0+${gx},${gy}`, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', HERE + 'stage/sos1.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const tap = (x, y) => adb('shell', 'input', 'tap', String(x), String(y));
  const t0 = Date.now(); const at = (s) => sleep(Math.max(0, t0 + s * 1000 - Date.now()));
  await at(3); tap(1006, 220); await at(4.5); tap(913, 493);       // Bahasa Melayu
  await at(8); tap(1006, 220); await at(9.5); tap(849, 367);       // English
  await at(11); tap(402, 2270);                                    // People
  await at(12.5); for (let i = 0; i < 4; i++) { tap(975, 494); await sleep(350); }
  tap(975, 623); await sleep(400); tap(975, 749);                  // a child, an elder
  await at(18); tap(678, 2270);                                    // Needs
  await at(19.5); for (const x of [132, 327, 547, 841]) { tap(x, 504); await sleep(450); }
  await at(22.5); tap(264, 820); await sleep(800); adb('shell', 'input', 'text', 'insulin');
  await sleep(800); adb('shell', 'input', 'keyevent', 'BACK');
  await at(27); tap(127, 2270);                                    // SOS tab
  await at(29); adb('shell', 'input', 'swipe', '540', '1215', '541', '1216', '2700');  // hold 2.7 s
  await at(46); tap(953, 2270);                                    // Supplies
  await at(52); tap(127, 2270);
  await at(56);
  const done = new Promise((r) => rec.on('exit', r)); rec.stdin.write('q'); await done;
};

S.android = async () => {
  await page.goto(STAGE + 'phone.html?src=sos1.mp4');
  await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
  await ov('cursor', false);
  recStart('04-android');
  await chip('3', 'Ark SOS for Android');
  await page.evaluate(() => window.__play());
  const t0 = Date.now(); const at = (s) => sleep(Math.max(0, t0 + s * 1000 - Date.now()));
  const side = (h, p) => page.evaluate(([h, p]) => { document.getElementById('rh').textContent = h; document.getElementById('rp').textContent = p; }, [h, p]);
  await cap('For the person who needs help', 'Here: a family on a roof in a flooded kampung near Beaufort, Sabah', 'Disaster relief');
  await at(3); await side('Their language', 'English, Bahasa Melayu, 中文 and தமிழ். The SOS carries the language so triage replies in it.');
  await cap('Switches language without a restart', 'Bahasa Melayu shown here');
  await at(11); await side('Who is with you?', '5 people: one child and one elder. Optional, and it can be sent after the SOS too.');
  await cap('Who is at risk', 'Children, elderly, disabled and pregnant women are counted separately');
  await at(18); await side('What do you need?', 'Water, food, medicine, baby supplies, and the exact medicine: insulin.');
  await cap('What they need', 'Typed in any language');
  await at(27); await side('Hold for 2 seconds', 'Letting go early cancels, so a pocket press never calls a drone. TalkBack users get a custom action.');
  await cap('Hold the red button for 2 seconds', 'It gets a GPS fix, then the SOS goes out with the location');
  await at(37); await side('Help is coming', 'The app follows the SOS: sent → help arranged → drone on the way → delivered, and keeps sharing the location.');
  await cap('The SOS is in. Help is being arranged', 'Location keeps updating every 30 s or 20 m from a foreground service');
  await at(46); await side('What the drone brings', 'Once the coordinator plans the flight, the kit and its weight against the 2 kg cap appear here.');
  await cap('Supplies tab', 'Shows the relief kit planned for this SOS');
  await at(54);
  await recStop();
};

S.fleet = async () => {
  await page.goto(DASH + '#/fleet');
  await page.waitForTimeout(7000);
  recStart('05-fleet');
  await chip('4', 'Ark Command · Fleet');
  await cap('The relief coordinator’s screen', '25 Ark-1 drones at 6 hubs across Sabah, live over MQTT (AWS IoT Core)', 'Relief operations');
  await sleep(5000);
  const inbox = page.getByLabel('Incoming SOS');
  await ring(inbox, 'The phone’s SOS from Beaufort: 5 people, a child and an elder, needs triaged and a kit packed', 'right');
  await cap('The SOS from the phone lands here', 'Nearest hub, urgency and a kit under the 2 kg cap, computed before anyone clicks');
  await sleep(7000);
  await ring(page.getByText('Flying weather').first().locator('xpath=..').locator('xpath=..'), 'Live wind and rain at every hub, plus a storm cell and its track', 'right');
  await cap('Will it fly?', 'Live weather per hub and rain radar; the dispatcher plans around the storm');
  await sleep(6000);
  await ring(page.locator('table, [aria-label*="rones"]').first(), 'Predictive maintenance grounds drones before they fail: bearing wear, weak cells, seal leaks', 'left');
  await cap('Drones that would fail are grounded first', 'A SageMaker-style model scores every finished flight');
  await sleep(7000);
  await unring();
  await cap('One click: dispatch to the fleet', 'A human approves every flight');
  await click(page.getByRole('button', { name: 'Dispatch to fleet' }));
  await sleep(3500);
  const disp = page.getByText('Dispatcher').first();
  await page.evaluate(() => document.querySelector('aside, [class*="overflow-y"]')?.scrollBy?.({ top: 400, behavior: 'smooth' }));
  await sleep(1200);
  await ring(disp.locator('xpath=..').locator('xpath=..'), 'The AI dispatcher picks a drone and explains why: distance, battery, health, weather', 'right');
  await cap('Every pick is explained', 'So the coordinator can trust it, or overrule it');
  await sleep(9000);
  await unring();
  await cap('Drones fly out over the flood', 'Sim running at 4× speed');
  await sleep(8000);
  await recStop();
  // wait for the phone to show the drone on the way, then keep a screenshot of it
  for (let i = 0; i < 30 && !/on the way|ETA/i.test(adb('shell', 'uiautomator', 'dump', '/dev/tty')); i++) await sleep(3000);
  execFileSync('sh', ['-c', `${ADB} exec-out screencap -p > ${HERE}stage/sos2.png`]);
};

S.phone2 = async () => {
  await page.goto(STAGE + `phone.html?src=sos2.png&rh=${encodeURIComponent('Meanwhile, on the roof')}&rp=${encodeURIComponent('The phone updated on its own: drone ARK-112 was dispatched, flew out and dropped the kit. No call centre in the loop.')}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
  await ov('cursor', false);
  recStart('06-phone-update');
  await chip('4', 'Ark Command · Fleet → Ark SOS');
  await page.evaluate(() => window.__play());
  await cap('Back on the roof: “Help has arrived”', 'ARK-112 delivered the kit to the family’s GPS location', 'Disaster relief');
  await sleep(8000);
  await recStop();
};

S.gdex = async () => {
  await page.goto(DASH);
  await page.waitForTimeout(7000);
  recStart('07-gdex');
  await chip('5', 'Ark Command · GDEX delivery');
  await cap('A GDEX operator sends a parcel to the interior', 'Start at the hub in Papar; destination: a village in the hills', 'GDEX last mile');
  await sleep(4500);
  const search = page.getByPlaceholder('Search places');
  await click(search);
  await page.keyboard.type('Kampung Kawang', { delay: 90 });
  await sleep(2500);
  await page.keyboard.press('ArrowDown').catch(() => {});
  await page.keyboard.press('Enter');
  await sleep(3500);
  await ring(page.getByText('Payload').first().locator('xpath=..'), 'A 1.2 kg GDEX parcel, checked against the 2 kg limit', 'right');
  await sleep(4000); await unring();
  await cap('Plan the route', 'Terrain, wind and rain along the way decide the altitude and the go/no-go');
  await click(page.getByRole('button', { name: 'Plan route' }));
  await sleep(6000);
  await cap('Review before it flies', 'Distance, ETA, terrain profile, weather checks: the operator signs off');
  await sleep(6000);
  await click(page.getByRole('button', { name: /Send to/ }));
  await cap('Sent to ARK-006', 'Over MQTT to its companion computer, then MAVLink to the ArduPilot autopilot');
  await sleep(14000);
  await cap('Live flight from the simulator', 'ArduCopter SITL on Ark-1 physics, real terrain and live wind');
  await sleep(8000);
  await click(page.getByRole('radio', { name: 'Chase' }).or(page.getByRole('button', { name: 'Chase' })));
  await cap('Chase camera', 'Flight safety stays on the drone: it finishes or aborts safely with no link');
  await sleep(9000);
  await click(page.getByRole('radio', { name: 'Onboard' }).or(page.getByRole('button', { name: 'Onboard' })));
  await cap('Onboard view', 'What the drone sees, with its HUD: altitude, speed, battery');
  await sleep(9000);
  await click(page.getByRole('radio', { name: 'Map' }).or(page.getByRole('button', { name: 'Map', exact: true })));
  // cruise: logged so assemble.py can time-lapse just this part
  const mark = {}, now = () => (Date.now() - recT0) / 1000;
  const left = () => page.evaluate(() => { const m = /Left\s*([\d.]+)\s*km/.exec(document.body.innerText); return m ? +m[1] : null; });
  await cap('10 km over the hills to Kampung Kawang', 'Cruise shown as a time-lapse', 'GDEX last mile');
  await sleep(2000);
  mark.cruiseStart = now();
  for (let i = 0; i < 900; i++) { const k = await left(); if (k !== null && k < 0.6) break; await sleep(1000); }
  mark.cruiseEnd = now();
  await click(page.getByRole('radio', { name: 'Chase' }).or(page.getByRole('button', { name: 'Chase' })));
  await cap('Arrived at Kampung Kawang', 'ARK-006 descends over the village to drop the parcel', 'GDEX last mile');
  const stage = () => page.evaluate(() => document.querySelector('[aria-label="Delivery state"] [aria-current="step"]')?.textContent ?? '');
  for (let i = 0; i < 120 && !/delivered|returning|home/.test(await stage()); i++) await sleep(1000);
  await sleep(4000);
  await cap('Parcel delivered. Heading home', 'Days by road and river, now about 12 minutes by air');
  await sleep(8000);
  await recStop();
  writeFileSync(OUT + '07-gdex.json', JSON.stringify(mark));
};

S.defence = async () => {
  // ARK-006 must already sit at MAIN BASE (spawn it there and restart the gateway), so the launch skips the respawn
  await page.goto(DASH + '#/defence');
  await page.waitForFunction(() => /SIM READY/.test(document.body.innerText) && !/STALE/.test(document.body.innerText) && /5\.0[23]\d*, 118\.3/.test(document.body.innerText), null, { timeout: 240000 });
  await page.waitForTimeout(3000);
  recStart('08-defence');
  await chip('6', 'Ark Command · Defence logistics terminal');
  await cap('The same drone, in military mode', 'For Malaysian Armed Forces logistics officers in the ESSZONE', 'Defence logistics');
  await sleep(5000);
  const q = page.getByLabel('Resupply queue');
  await ring(page.getByText('REQ-0412').first().locator('xpath=..').locator('xpath=..'), 'FLASH: 4 units of O-negative blood to FOB Kestrel', 'right');
  await cap('Resupply requests, ranked by priority', 'Blood, radio batteries, water, medical kits');
  await sleep(5500);
  await ring(page.getByText('NO ROUTE').first(), 'A drop inside a threat zone is refused: no route', 'right');
  await sleep(4500); await unring();
  await click(page.getByText('REQ-0412').first());
  await sleep(800);
  await click(page.getByRole('button', { name: /PLAN ROUTE/ }));
  await cap('Plan around the threat zones', 'The direct line is blocked; the route detours around the two no-fly zones');
  await sleep(4000);
  await ring(page.getByLabel('Tactical map'), 'Dashed: the route · dotted red: the blocked direct line', 'left');
  await sleep(6000);
  await ring(page.getByLabel('Resupply plan'), 'Go / no-go checks: pack, weather, link, detour, altitude', 'right');
  await cap('Two-person rule', 'A second operator must confirm before launch');
  await sleep(5000); await unring();
  await click(page.getByRole('checkbox'));
  await sleep(1200);
  await click(page.getByRole('button', { name: /AUTHORISE LAUNCH/ }));
  await cap('Authorised. ARK-006 is on its way', 'Every step lands in the event log for the after-action report');
  await sleep(24000);
  await ring(page.locator('[aria-label="Live telemetry"]'), 'Live telemetry from the drone', 'left');
  await sleep(6000); await unring();
  await sleep(4000);
  await recStop();
};

S.drone = async () => {
  await page.goto(STAGE + 'ark_viewer.html');
  await page.waitForTimeout(6000);
  recStart('09-drone');
  await chip('7', 'Ark-1 · 3D model');
  await cap('Ark-1: the amphibious drone', 'Hardware is designed and simulated, to a level you could build from');
  const b = (id) => click(page.locator('#' + id));
  await b('t-spin'); await sleep(5000);
  await b('t-spin');
  await cap('A machined unibody, sized from the electronics inside', 'Cargo pod underneath carries up to 2 kg');
  await b('v-side'); await sleep(4000);
  await b('t-xray');
  await cap('Cutaway: the real parts', 'SPICE-modelled power chain and a 1:1 wiring harness of catalogue parts');
  await sleep(6000);
  await b('t-xray');
  await b('t-float');
  await cap('Pontoons inflate for a water landing', 'Triggered by the flight controller when the landing spot is water');
  await b('v-hero'); await sleep(5000);
  await b('t-water');
  await cap('On the water', 'It lands on a flood, delivers, and takes off again');
  await sleep(6000);
  await b('v-under'); await sleep(3500);
  await b('v-hero'); await b('t-spin');
  await cap('Ark-1 · Noah’s Ark', 'Flies in rain · lands on water · thinks on AWS');
  await sleep(5000);
  await recStop();
};

S.outro = async () => {
  await page.goto('about:blank');
  await page.addStyleTag({ content: 'html,body{background:#05080e}' });
  await sleep(500);
  await ov('cursor', false);
  recStart(process.env.OUTRO ?? '10-outro');
  await ov('card', `<div><h1>Noah's <span>Ark</span></h1><p>Flood victims · interior communities · frontline units.<br>One amphibious fleet, one AI brain.</p>
    <div class="k">Amazon Bedrock · PartyRock · IoT Core · SageMaker · Location Service · Lambda · Step Functions</div><div class="k" style="margin-top:60px;font-size:14px;letter-spacing:.04em;text-transform:none;line-height:1.6">${process.env.CREDIT ?? 'Music: “Inspired” by Kevin MacLeod (incompetech.com) · Licensed under CC BY 4.0'}</div></div>`);
  await sleep(7000);
  await recStop();
};

// --- main ---------------------------------------------------------------------------------------------------------
const names = process.argv.slice(2);
const needsBrowser = names.some((n) => n !== 'phone');
let ctx;
if (needsBrowser) {
  ctx = await chromium.launchPersistentContext(process.env.PROFILE ?? HERE + '.chrome-profile', {
    channel: 'chrome', headless: false, viewport: null, bypassCSP: true, ignoreDefaultArgs: ['--enable-automation', '--password-store=basic', '--use-mock-keychain'],
    args: ['--kiosk', '--disable-accelerated-video-decode', '--hide-scrollbars', '--force-device-scale-factor=1.6', '--disable-infobars', '--autoplay-policy=no-user-gesture-required', '--no-first-run'],
  });
  await ctx.addInitScript({ content: readFileSync(HERE + 'overlay.js', 'utf8') });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5173' });
  page = ctx.pages()[0] ?? (await ctx.newPage());
}
for (const n of names) {
  console.log('==>', n);
  try { await S[n](); } catch (e) { console.error(n, 'failed:', e.message); if (ff && ff.exitCode === null) await recStop(); }
}
await ctx?.close();
