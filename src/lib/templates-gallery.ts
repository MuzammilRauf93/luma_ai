import type { Template } from "./templates";

/**
 * Phase 3 templates gallery: ready-made static starters, each with a suggested
 * first goal and extra agents that suit the project. Plain HTML/CSS/JS so the
 * live preview works with no build step.
 */

const head = (title: string, fonts = "") => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>${fonts}
  <link rel="stylesheet" href="css/style.css" />
</head>`;

const navJs = `// Mobile menu toggle + current year in the footer.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector("[data-menu]");
  const nav = document.querySelector("[data-nav]");
  btn?.addEventListener("click", () => nav?.classList.toggle("open"));
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
});
`;

const resetCss = `* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.6; }
img { max-width: 100%; display: block; }
a { color: inherit; }
.wrap { max-width: var(--max, 1080px); margin: 0 auto; padding: 0 20px; }
.btn { display: inline-block; padding: 12px 20px; border-radius: 999px; background: var(--accent); color: var(--on-accent, #fff); text-decoration: none; font-weight: 600; }
.btn.ghost { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1.5px currentColor; }
.top { display: flex; align-items: center; justify-content: space-between; padding: 18px 0; }
.top nav { display: flex; gap: 22px; }
.top nav a { text-decoration: none; color: var(--muted); font-weight: 500; }
.top nav a:hover { color: var(--text); }
.menu { display: none; background: none; border: 0; font-size: 22px; color: var(--text); }
@media (max-width: 720px) {
  .menu { display: block; }
  .top nav { display: none; position: absolute; top: 64px; left: 0; right: 0; flex-direction: column; padding: 16px 20px; background: var(--bg); border-bottom: 1px solid var(--line); }
  .top nav.open { display: flex; }
}
footer { padding: 40px 0; color: var(--muted); font-size: 14px; }
`;

// ---------------------------------------------------------------- Portfolio
const portfolioHtml = `${head("Alex Morgan — Designer & Developer", '\n  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet" />')}
<body>
  <header class="wrap top">
    <a href="#" class="logo">Alex Morgan</a>
    <button class="menu" data-menu aria-label="Menu">☰</button>
    <nav data-nav><a href="#work">Work</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
  </header>
  <main>
    <section class="wrap hero">
      <p class="eyebrow">Product designer & front-end developer</p>
      <h1>I design calm, useful products for the web.</h1>
      <p class="lede">Currently helping small teams turn messy ideas into simple interfaces. Previously at a few startups you've probably never heard of.</p>
      <a class="btn" href="#work">See my work</a>
    </section>
    <section id="work" class="wrap grid">
      <article class="card"><div class="thumb" style="--c:#c7d2fe"></div><h3>Habit tracker app</h3><p>Mobile app design · 2026</p></article>
      <article class="card"><div class="thumb" style="--c:#fbcfe8"></div><h3>Bakery rebrand</h3><p>Brand & website · 2025</p></article>
      <article class="card"><div class="thumb" style="--c:#bbf7d0"></div><h3>Analytics dashboard</h3><p>Product design · 2025</p></article>
      <article class="card"><div class="thumb" style="--c:#fde68a"></div><h3>Travel journal</h3><p>Side project · 2024</p></article>
    </section>
    <section id="about" class="wrap about">
      <h2>About</h2>
      <p>I care about clear typography, honest copy and interfaces that get out of the way. Outside work I take film photos and bake too much bread.</p>
    </section>
    <section id="contact" class="wrap contact">
      <h2>Let's work together</h2>
      <a class="btn" href="mailto:hello@example.com">hello@example.com</a>
    </section>
  </main>
  <footer class="wrap">© <span data-year></span> Alex Morgan</footer>
  <script src="js/main.js"></script>
</body>
</html>
`;
const portfolioCss = `:root { --bg: #fcfcfd; --text: #111827; --muted: #6b7280; --line: #e5e7eb; --accent: #111827; --font: Inter, system-ui, sans-serif; --max: 1040px; }
${resetCss}
.logo { font-weight: 800; text-decoration: none; letter-spacing: -0.02em; }
.hero { padding: 72px 20px 56px; }
.eyebrow { color: var(--muted); font-weight: 600; margin: 0 0 8px; }
.hero h1 { font-size: clamp(2.2rem, 6vw, 4rem); line-height: 1.05; letter-spacing: -0.04em; margin: 0 0 18px; max-width: 14ch; }
.lede { font-size: 1.15rem; color: var(--muted); max-width: 52ch; margin: 0 0 28px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; padding-bottom: 48px; }
.card h3 { margin: 12px 0 2px; font-size: 1.05rem; }
.card p { margin: 0; color: var(--muted); font-size: 14px; }
.thumb { aspect-ratio: 4 / 3; border-radius: 16px; background: var(--c); transition: transform .3s; }
.card:hover .thumb { transform: translateY(-4px); }
.about, .contact { padding: 40px 20px; border-top: 1px solid var(--line); }
.about p { max-width: 60ch; color: var(--muted); font-size: 1.1rem; }
`;

// ---------------------------------------------------------------- Blog
const blogHtml = `${head("Field Notes — a small blog", '\n  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet" />')}
<body>
  <header class="wrap top">
    <a href="index.html" class="logo">Field Notes</a>
    <button class="menu" data-menu aria-label="Menu">☰</button>
    <nav data-nav><a href="index.html">Writing</a><a href="#about">About</a><a href="#subscribe">Subscribe</a></nav>
  </header>
  <main class="wrap">
    <section class="intro">
      <h1>Notes on slow living, good tools and small businesses.</h1>
      <p>A new essay every other Sunday.</p>
    </section>
    <ol class="posts">
      <li><a href="posts/first-post.html"><time>Oct 12, 2026</time><h2>Why I write everything down</h2><p>A short case for keeping a paper notebook in a very digital life.</p></a></li>
      <li><a href="posts/first-post.html"><time>Sep 28, 2026</time><h2>The tools I actually use</h2><p>Fewer apps, better habits.</p></a></li>
      <li><a href="posts/first-post.html"><time>Sep 14, 2026</time><h2>Opening a shop with no budget</h2><p>Lessons from the first year of running a tiny bakery.</p></a></li>
    </ol>
    <section id="subscribe" class="subscribe">
      <h3>Get new posts by email</h3>
      <form onsubmit="event.preventDefault(); this.innerHTML='<p>Thanks! You\\'re on the list.</p>'">
        <input type="email" required placeholder="you@example.com" aria-label="Email address" />
        <button class="btn">Subscribe</button>
      </form>
    </section>
  </main>
  <footer class="wrap" id="about">© <span data-year></span> Field Notes · Written by a human.</footer>
  <script src="js/main.js"></script>
</body>
</html>
`;
const blogPost = `${head("Why I write everything down — Field Notes").replace('href="css/style.css"', 'href="../css/style.css"')}
<body>
  <header class="wrap top"><a href="../index.html" class="logo">Field Notes</a></header>
  <article class="wrap post">
    <time>Oct 12, 2026</time>
    <h1>Why I write everything down</h1>
    <p>This is a sample post. Your Content Writer can replace it with real articles, and your developer can turn this page into a template.</p>
    <h2>A heading inside the post</h2>
    <p>Good blog typography means comfortable line length, generous spacing and a readable serif.</p>
    <blockquote>“Writing is thinking on paper.”</blockquote>
    <p><a href="../index.html">← Back to all posts</a></p>
  </article>
  <script src="../js/main.js"></script>
</body>
</html>
`;
const blogCss = `:root { --bg: #fffdf8; --text: #1f1d1a; --muted: #7a736b; --line: #ece6dc; --accent: #9a3412; --font: "Source Serif 4", Georgia, serif; --max: 720px; }
${resetCss}
.top, .top nav a, .btn, input, time { font-family: Inter, system-ui, sans-serif; }
.logo { font-weight: 700; text-decoration: none; font-size: 1.15rem; }
.intro { padding: 48px 0 24px; border-bottom: 1px solid var(--line); }
.intro h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); line-height: 1.15; margin: 0 0 8px; }
.intro p { color: var(--muted); margin: 0; }
.posts { list-style: none; padding: 0; margin: 0; }
.posts a { display: block; padding: 26px 0; border-bottom: 1px solid var(--line); text-decoration: none; }
.posts h2 { margin: 4px 0; font-size: 1.45rem; }
.posts a:hover h2 { color: var(--accent); }
.posts p { margin: 0; color: var(--muted); }
time { color: var(--muted); font-size: 13px; }
.subscribe { margin: 40px 0; padding: 28px; border-radius: 16px; background: #f6efe4; }
.subscribe h3 { margin-top: 0; }
.subscribe form { display: flex; gap: 8px; flex-wrap: wrap; }
.subscribe input { flex: 1; min-width: 200px; padding: 12px 16px; border-radius: 999px; border: 1px solid var(--line); font-size: 15px; }
.post { padding: 32px 20px 64px; font-size: 1.15rem; }
.post h1 { font-size: clamp(2rem, 6vw, 2.8rem); line-height: 1.1; margin: 6px 0 24px; }
blockquote { margin: 24px 0; padding-left: 18px; border-left: 3px solid var(--accent); color: var(--muted); font-style: italic; }
`;

// ---------------------------------------------------------------- Restaurant / local business
const restaurantHtml = `${head("Saffron & Salt — Kitchen", '\n  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet" />')}
<body>
  <header class="wrap top">
    <a href="#" class="logo">Saffron & Salt</a>
    <button class="menu" data-menu aria-label="Menu">☰</button>
    <nav data-nav><a href="#menu">Menu</a><a href="#hours">Hours</a><a href="#visit">Visit</a></nav>
  </header>
  <section class="hero">
    <div class="wrap">
      <h1>Slow-cooked food,<br/>fast friends.</h1>
      <p>A family kitchen serving seasonal dishes from our grandmother's recipes.</p>
      <a class="btn" href="#visit">Book a table</a>
    </div>
  </section>
  <main class="wrap">
    <section id="menu" class="menu-list">
      <h2>Menu</h2>
      <div class="dishes">
        <div class="dish"><div><h3>Saffron chicken pulao</h3><p>Fragrant rice, slow-roasted chicken, crispy onions</p></div><span>$18</span></div>
        <div class="dish"><div><h3>Charred aubergine</h3><p>Yoghurt, pomegranate, mint</p></div><span>$12</span></div>
        <div class="dish"><div><h3>Lamb karahi</h3><p>Tomato, ginger, green chilli, fresh naan</p></div><span>$22</span></div>
        <div class="dish"><div><h3>Cardamom kheer</h3><p>Rice pudding, pistachio, rose</p></div><span>$8</span></div>
      </div>
    </section>
    <section class="info">
      <div id="hours"><h2>Hours</h2><p>Tue–Thu · 5pm – 10pm<br/>Fri–Sun · 12pm – 11pm<br/>Mon · closed</p></div>
      <div id="visit"><h2>Visit</h2><p>12 Market Street<br/>Your City<br/><a href="tel:+10000000000">(000) 000-0000</a></p></div>
    </section>
  </main>
  <footer class="wrap">© <span data-year></span> Saffron & Salt</footer>
  <script src="js/main.js"></script>
</body>
</html>
`;
const restaurantCss = `:root { --bg: #fbf7f2; --text: #2a1f1a; --muted: #85766a; --line: #eadfd3; --accent: #c2410c; --font: Inter, system-ui, sans-serif; }
${resetCss}
h1, h2, h3, .logo { font-family: Fraunces, Georgia, serif; }
.logo { font-weight: 700; text-decoration: none; font-size: 1.3rem; }
.hero { background: linear-gradient(135deg, #7c2d12, #c2410c 60%, #f59e0b); color: #fff7ed; padding: 96px 0; }
.hero h1 { font-size: clamp(2.4rem, 7vw, 4.4rem); line-height: 1.02; margin: 0 0 16px; }
.hero p { max-width: 44ch; opacity: .9; font-size: 1.1rem; margin: 0 0 28px; }
.hero .btn { background: #fff7ed; color: #7c2d12; }
.menu-list { padding: 56px 0 24px; }
.dishes { display: grid; gap: 4px; }
.dish { display: flex; justify-content: space-between; gap: 16px; padding: 18px 0; border-bottom: 1px dashed var(--line); }
.dish h3 { margin: 0; font-size: 1.15rem; }
.dish p { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
.dish span { font-weight: 600; color: var(--accent); }
.info { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; padding: 32px 0 56px; }
.info p { color: var(--muted); }
`;

// ---------------------------------------------------------------- Dashboard
const dashboardHtml = `${head("Pulse — Dashboard")}
<body>
  <div class="app">
    <aside class="side">
      <div class="logo">◆ Pulse</div>
      <nav><a class="active" href="#">Overview</a><a href="#">Customers</a><a href="#">Orders</a><a href="#">Reports</a><a href="#">Settings</a></nav>
    </aside>
    <main class="main">
      <header class="bar"><h1>Overview</h1><input placeholder="Search…" aria-label="Search" /></header>
      <section class="kpis">
        <div class="kpi"><span>Revenue</span><b>$48,210</b><em class="up">+12.4%</em></div>
        <div class="kpi"><span>Orders</span><b>1,284</b><em class="up">+5.1%</em></div>
        <div class="kpi"><span>New customers</span><b>312</b><em class="down">−2.3%</em></div>
        <div class="kpi"><span>Refund rate</span><b>1.8%</b><em class="up">−0.4 pts</em></div>
      </section>
      <section class="panel">
        <h2>Revenue, last 12 weeks</h2>
        <div class="bars" id="bars" aria-label="Bar chart"></div>
      </section>
      <section class="panel">
        <h2>Recent orders</h2>
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>
            <tr><td>#1042</td><td>Sana Malik</td><td><span class="pill ok">Paid</span></td><td class="num">$129.00</td></tr>
            <tr><td>#1041</td><td>James Lee</td><td><span class="pill wait">Pending</span></td><td class="num">$58.40</td></tr>
            <tr><td>#1040</td><td>Ana Souza</td><td><span class="pill ok">Paid</span></td><td class="num">$212.10</td></tr>
          </tbody>
        </table>
      </section>
    </main>
  </div>
  <script src="js/main.js"></script>
</body>
</html>
`;
const dashboardCss = `:root { --bg: #f6f7fb; --panel: #fff; --text: #0f172a; --muted: #64748b; --line: #e2e8f0; --accent: #4f46e5; --font: ui-sans-serif, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b1020; --panel: #121a2f; --text: #e2e8f0; --muted: #94a3b8; --line: #1e293b; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); }
.app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.side { background: var(--panel); border-right: 1px solid var(--line); padding: 20px 14px; }
.logo { font-weight: 800; padding: 0 8px 20px; color: var(--accent); }
.side nav { display: grid; gap: 2px; }
.side a { padding: 9px 10px; border-radius: 8px; color: var(--muted); text-decoration: none; font-size: 14px; }
.side a.active, .side a:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text); }
.main { padding: 24px; display: grid; gap: 18px; align-content: start; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bar h1 { margin: 0; font-size: 22px; }
.bar input { padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--text); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.kpi, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
.kpi span { color: var(--muted); font-size: 13px; display: block; }
.kpi b { font-size: 26px; display: block; margin: 4px 0; font-variant-numeric: tabular-nums; }
.kpi em { font-style: normal; font-size: 13px; font-weight: 600; }
.up { color: #059669; } .down { color: #dc2626; }
.panel h2 { margin: 0 0 14px; font-size: 15px; }
.bars { display: flex; align-items: flex-end; gap: 8px; height: 180px; }
.bars div { flex: 1; background: var(--accent); border-radius: 6px 6px 0 0; opacity: .85; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px; border-bottom: 1px solid var(--line); }
td { padding: 10px 8px; border-bottom: 1px solid var(--line); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.pill { font-size: 12px; padding: 3px 8px; border-radius: 999px; font-weight: 600; }
.pill.ok { background: #d1fae5; color: #065f46; } .pill.wait { background: #fef3c7; color: #92400e; }
@media (max-width: 760px) { .app { grid-template-columns: 1fr; } .side { display: none; } }
`;
const dashboardJs = `// Draw the demo bar chart. Replace the numbers with real data later.
document.addEventListener("DOMContentLoaded", () => {
  const data = [12, 18, 15, 22, 19, 26, 24, 31, 28, 34, 30, 38];
  const max = Math.max(...data);
  const el = document.getElementById("bars");
  data.forEach((v, i) => {
    const bar = document.createElement("div");
    bar.style.height = (v / max) * 100 + "%";
    bar.title = "Week " + (i + 1) + ": $" + v + "k";
    el.appendChild(bar);
  });
});
`;

// ---------------------------------------------------------------- Docs site
const docsHtml = `${head("Acme Docs")}
<body>
  <header class="topbar"><div class="logo">📘 Acme Docs</div><input placeholder="Search docs…" aria-label="Search docs" /></header>
  <div class="layout">
    <nav class="toc">
      <h4>Getting started</h4>
      <a class="active" href="#intro">Introduction</a><a href="#install">Installation</a><a href="#quickstart">Quick start</a>
      <h4>Guides</h4>
      <a href="#">Configuration</a><a href="#">Deploying</a><a href="#">FAQ</a>
    </nav>
    <article class="content">
      <h1 id="intro">Introduction</h1>
      <p>Acme helps you do the thing, faster. This page is a starter: your agents can turn it into real documentation for your product.</p>
      <div class="note"><b>Tip:</b> keep each page focused on one task.</div>
      <h2 id="install">Installation</h2>
      <pre><code>npm install acme</code></pre>
      <h2 id="quickstart">Quick start</h2>
      <ol><li>Create an account.</li><li>Copy your API key.</li><li>Make your first request.</li></ol>
      <pre><code>import { Acme } from "acme";
const acme = new Acme({ apiKey: "YOUR_KEY" });</code></pre>
    </article>
  </div>
  <script src="js/main.js"></script>
</body>
</html>
`;
const docsCss = `:root { --bg: #fff; --text: #0f172a; --muted: #64748b; --line: #e2e8f0; --accent: #0284c7; --code: #0f172a; --font: ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.7; }
.topbar { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.9); backdrop-filter: blur(6px); }
.logo { font-weight: 700; }
.topbar input { padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; min-width: 220px; }
.layout { display: grid; grid-template-columns: 240px minmax(0, 760px); gap: 40px; max-width: 1080px; margin: 0 auto; padding: 24px; }
.toc { position: sticky; top: 72px; align-self: start; display: grid; gap: 2px; font-size: 14px; }
.toc h4 { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.toc a { color: var(--muted); text-decoration: none; padding: 4px 10px; border-radius: 6px; }
.toc a.active, .toc a:hover { color: var(--accent); background: #f0f9ff; }
.content h1 { font-size: 2.2rem; margin: 0 0 12px; }
.content h2 { margin-top: 36px; padding-top: 12px; border-top: 1px solid var(--line); }
pre { background: var(--code); color: #e2e8f0; padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-size: 13.5px; }
.note { background: #f0f9ff; border-left: 3px solid var(--accent); padding: 10px 14px; border-radius: 6px; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } .toc { display: none; } }
`;

// ---------------------------------------------------------------- Event
const eventHtml = `${head("Build Day 2026 — a one-day maker festival", '\n  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />')}
<body>
  <section class="hero">
    <div class="wrap">
      <p class="date">Sat · 14 March 2026 · City Hall</p>
      <h1>Build Day<br/>2026</h1>
      <p class="lede">One day of talks, workshops and demos for people who make things.</p>
      <div class="cta"><a class="btn" href="#tickets">Get tickets</a><a class="btn ghost" href="#schedule">Schedule</a></div>
      <div class="countdown" data-countdown="2026-03-14T09:00:00"></div>
    </div>
  </section>
  <main class="wrap">
    <section id="schedule">
      <h2>Schedule</h2>
      <ul class="schedule">
        <li><time>09:00</time><span>Doors open & coffee</span></li>
        <li><time>10:00</time><span>Keynote: Making small things well</span></li>
        <li><time>13:00</time><span>Workshops (pick one of four)</span></li>
        <li><time>17:00</time><span>Demo hour & drinks</span></li>
      </ul>
    </section>
    <section id="tickets" class="tickets">
      <div class="ticket"><h3>Standard</h3><b>$49</b><p>All talks and demo hour</p></div>
      <div class="ticket featured"><h3>Maker</h3><b>$89</b><p>Everything + one workshop</p></div>
    </section>
  </main>
  <footer class="wrap">© <span data-year></span> Build Day</footer>
  <script src="js/main.js"></script>
</body>
</html>
`;
const eventCss = `:root { --bg: #0c0a1d; --text: #f5f3ff; --muted: #a5a1c4; --line: #2a2550; --accent: #a3e635; --on-accent: #0c0a1d; --font: "Space Grotesk", system-ui, sans-serif; }
${resetCss}
.hero { padding: 96px 0 72px; background: radial-gradient(60% 60% at 80% 10%, #6d28d9 0%, transparent 70%), radial-gradient(50% 50% at 10% 90%, #0ea5e9 0%, transparent 70%); }
.date { color: var(--accent); font-weight: 700; letter-spacing: .04em; }
.hero h1 { font-size: clamp(3rem, 12vw, 7rem); line-height: .9; margin: 12px 0 20px; letter-spacing: -0.04em; }
.lede { font-size: 1.2rem; color: var(--muted); max-width: 40ch; }
.cta { display: flex; gap: 10px; flex-wrap: wrap; margin: 24px 0; }
.countdown { font-size: 1.1rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.schedule { list-style: none; padding: 0; }
.schedule li { display: flex; gap: 24px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.schedule time { color: var(--accent); font-weight: 700; min-width: 64px; }
.tickets { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 48px 0; }
.ticket { border: 1px solid var(--line); border-radius: 18px; padding: 24px; }
.ticket b { font-size: 2.2rem; }
.ticket.featured { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
`;
const eventJs =
  navJs +
  `
// Live countdown to the event date in [data-countdown].
document.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector("[data-countdown]");
  if (!el) return;
  const target = new Date(el.dataset.countdown).getTime();
  const tick = () => {
    const ms = target - Date.now();
    if (ms <= 0) return (el.textContent = "It's happening now!");
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    el.textContent = d + " days · " + h + " hours · " + m + " minutes to go";
  };
  tick();
  setInterval(tick, 30000);
});
`;

const STATIC = "Static website: HTML, CSS, vanilla JavaScript";

export const GALLERY_TEMPLATES: Template[] = [
  {
    key: "portfolio",
    name: "Portfolio",
    icon: "🎨",
    category: "Personal",
    description: "A clean personal portfolio with a projects grid, about and contact.",
    techStack: STATIC,
    starterGoal: "Turn this into my portfolio. I'm a [your job]. Show my best 4–6 projects with a short case study page for each, an about section, and a contact link.",
    files: { "index.html": portfolioHtml, "css/style.css": portfolioCss, "js/main.js": navJs },
  },
  {
    key: "blog",
    name: "Blog",
    icon: "✍️",
    category: "Content",
    description: "A readable blog with a post list, a post page and an email signup.",
    techStack: STATIC,
    extraAgents: ["content_writer"],
    starterGoal: "Make this my blog about [topic]. Write three real starter posts, add an about page, and make every post page share the same layout.",
    files: { "index.html": blogHtml, "posts/first-post.html": blogPost, "css/style.css": blogCss, "js/main.js": navJs },
  },
  {
    key: "restaurant",
    name: "Restaurant & local business",
    icon: "🍽️",
    category: "Business",
    description: "Menu, opening hours and directions for a café, restaurant or shop.",
    techStack: STATIC,
    extraAgents: ["content_writer"],
    starterGoal: "Make this the website for my business, [name], a [type of business] in [city]. Add our real menu/services, opening hours, a map link and a simple booking or contact form.",
    files: { "index.html": restaurantHtml, "css/style.css": restaurantCss, "js/main.js": navJs },
  },
  {
    key: "dashboard",
    name: "Admin dashboard",
    icon: "📊",
    category: "App",
    description: "KPI cards, a chart and a data table with a sidebar layout. Dark mode included.",
    techStack: STATIC + ". Data lives in data/*.json loaded with fetch().",
    extraAgents: ["backend_developer"],
    starterGoal: "Turn this into a dashboard for [what you track]. Load the numbers from a JSON file, add filters by date range, and make the Customers page work.",
    files: { "index.html": dashboardHtml, "css/style.css": dashboardCss, "js/main.js": dashboardJs },
  },
  {
    key: "docs",
    name: "Documentation site",
    icon: "📘",
    category: "Content",
    description: "Sidebar navigation, code blocks and callouts for product docs or a handbook.",
    techStack: STATIC,
    extraAgents: ["content_writer"],
    starterGoal: "Turn this into documentation for [product or team handbook]. Create separate pages for each section, keep the sidebar in sync, and add working search over page titles.",
    files: { "index.html": docsHtml, "css/style.css": docsCss, "js/main.js": navJs },
  },
  {
    key: "event",
    name: "Event page",
    icon: "🎟️",
    category: "Business",
    description: "A bold one-pager with a countdown, schedule and ticket options.",
    techStack: STATIC,
    starterGoal: "Make this the page for my event, [name], on [date] at [place]. Add speakers with photos, an FAQ, and a sign-up form.",
    files: { "index.html": eventHtml, "css/style.css": eventCss, "js/main.js": eventJs },
  },
];
