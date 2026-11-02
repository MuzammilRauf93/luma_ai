/** Starter templates for new workspaces (plan §3.2). Phase 3 adds the gallery in templates-gallery.ts. */
import { GALLERY_TEMPLATES } from "./templates-gallery";

export interface Template {
  key: string;
  name: string;
  icon: string;
  description: string;
  techStack: string;
  platform?: "web" | "flutter";
  /** Gallery grouping, e.g. "Business". */
  category?: string;
  /** Pre-filled first goal for the Project Manager ([brackets] = fill in). */
  starterGoal?: string;
  /** Extra predefined agents (preset keys) added to this workspace's team. */
  extraAgents?: string[];
  files: Record<string, string>;
}

const blankHtml = (title: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>
  <main class="empty">
    <h1>${title}</h1>
    <p>Your agents haven't built anything yet. Describe your goal on the Overview page to get started.</p>
  </main>
  <script src="js/main.js"></script>
</body>
</html>
`;

const baseCss = `:root {
  --bg: #fafaf9;
  --text: #1c1917;
  --muted: #78716c;
  --accent: #7c3aed;
  --radius: 14px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.6; }
.empty { min-height: 100vh; display: grid; place-content: center; text-align: center; padding: 24px; }
.empty h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 44px); }
.empty p { color: var(--muted); max-width: 46ch; margin: 0 auto; }
`;

const landingHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Product</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>
  <header class="nav">
    <a class="brand" href="#">Your Product</a>
    <nav><a href="#features">Features</a><a href="#contact">Contact</a></nav>
  </header>
  <section class="hero">
    <h1>A headline that says what you do</h1>
    <p>One sentence that explains who it's for and why it matters.</p>
    <a class="btn" href="#contact">Get started</a>
  </section>
  <section id="features" class="features">
    <article><h3>Feature one</h3><p>Short benefit-focused description.</p></article>
    <article><h3>Feature two</h3><p>Short benefit-focused description.</p></article>
    <article><h3>Feature three</h3><p>Short benefit-focused description.</p></article>
  </section>
  <footer id="contact" class="footer">
    <p>© <span id="year"></span> Your Product · hello@example.com</p>
  </footer>
  <script src="js/main.js"></script>
</body>
</html>
`;

const landingCss = `:root {
  --bg: #ffffff;
  --surface: #f5f5f4;
  --text: #1c1917;
  --muted: #57534e;
  --accent: #7c3aed;
  --radius: 14px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.6; }
a { color: inherit; }
.nav { display: flex; justify-content: space-between; align-items: center; padding: 20px clamp(16px, 5vw, 64px); }
.nav nav a { margin-left: 20px; text-decoration: none; color: var(--muted); }
.brand { font-weight: 700; text-decoration: none; }
.hero { text-align: center; padding: 96px 16px 72px; }
.hero h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.1; margin: 0 auto 16px; max-width: 18ch; }
.hero p { color: var(--muted); font-size: 18px; max-width: 48ch; margin: 0 auto 28px; }
.btn { display: inline-block; background: var(--accent); color: #fff; padding: 12px 22px; border-radius: 999px; text-decoration: none; font-weight: 600; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 0 clamp(16px, 5vw, 64px) 80px; }
.features article { background: var(--surface); border-radius: var(--radius); padding: 24px; }
.features h3 { margin-top: 0; }
.footer { text-align: center; color: var(--muted); padding: 32px 16px; border-top: 1px solid var(--surface); }
`;

const mainJs = `document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
});
`;


const pubspec = `name: app
description: A mobile app built with Luma AI.
publish_to: "none"
version: 1.0.0+1

environment:
  sdk: ^3.5.0

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^5.0.0

flutter:
  uses-material-design: true
`;

const mainDart = `import 'package:flutter/material.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'My App',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7C3AED)),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.auto_awesome, size: 48, color: theme.colorScheme.primary),
                const SizedBox(height: 16),
                Text('My App', style: theme.textTheme.headlineMedium),
                const SizedBox(height: 8),
                Text(
                  "Your agents haven't built anything yet. Describe your app on the Overview page to get started.",
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
`;

const BASE_TEMPLATES: Template[] = [
  {
    key: "blank",
    category: "Start",
    starterGoal: "",
    name: "Blank website",
    icon: "✨",
    description: "An empty starting point. Your agents build everything from your description.",
    techStack: "Static website: HTML, CSS, vanilla JavaScript",
    files: {
      "index.html": blankHtml("My Website"),
      "css/style.css": baseCss,
      "js/main.js": mainJs,
    },
  },
  {
    key: "landing",
    category: "Business",
    starterGoal: "Turn this into a landing page for [product]. Explain who it's for, the three main benefits, pricing, an FAQ and a sign-up form.",
    name: "Landing page",
    icon: "🚀",
    description: "Hero, feature grid and footer, ready for your agents to customise.",
    techStack: "Static website: HTML, CSS, vanilla JavaScript",
    files: {
      "index.html": landingHtml,
      "css/style.css": landingCss,
      "js/main.js": mainJs,
    },
  },
  {
    key: "flutter",
    category: "App",
    starterGoal: "Build an iPhone app that [does what]. Start with a home screen, a list screen and a detail screen.",
    name: "Mobile app (Flutter)",
    icon: "📱",
    description: "An iPhone app that runs live in the iOS Simulator on your Mac. Needs Xcode + Flutter.",
    techStack: "Flutter (Dart) mobile app for iOS. Code in lib/, packages in pubspec.yaml.",
    platform: "flutter",
    files: {
      "pubspec.yaml": pubspec,
      "analysis_options.yaml": "include: package:flutter_lints/flutter.yaml\n",
      "lib/main.dart": mainDart,
    },
  },
];

export const TEMPLATES: Template[] = [...BASE_TEMPLATES, ...GALLERY_TEMPLATES];

/** A self-contained HTML preview of a template (CSS/JS inlined) for the gallery thumbnails. */
export function templatePreview(t: Template): string | null {
  let html = t.files["index.html"];
  if (!html) return null;
  html = html.replace(/<link[^>]+href="css\/style\.css"[^>]*>/, () => `<style>${t.files["css/style.css"] ?? ""}</style>`);
  html = html.replace(/<script src="js\/main\.js"><\/script>/, () => `<script>${t.files["js/main.js"] ?? ""}</script>`);
  return html;
}

export function getTemplate(key: string) {
  return TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0];
}
