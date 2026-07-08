# Titanhub - ACG All-in-One Aggregation Platform

> One App, All ACG Content (Anime, Manga, Novels, Movies).

Titanhub is a modern cross-platform aggregator for ACG content. It features a Flutter mobile/desktop client, a GSAP-powered Next.js 15 web client, and a lightweight Hono API backend running on Bun.

---

## Key Features

1. **Wasm Sandbox HTML Parsing Engine (v2)**: Parses HTML web documents natively inside a secure WebAssembly QuickJS sandbox context (`quickjs-emscripten`) by utilizing a host-side `cheerio` parsing bridge.
2. **Parallel Multi-Node Scraper Aggregation**: Queries all activated/loaded plugin nodes concurrently using parallel asynchronous requests and merges results with dynamic origin badges.
3. **GPU-Accelerated 3D Hover Tilt Effects**: Implements responsive cursor-tracking transformations on web content cards utilizing GSAP ticker loops at a locked 144Hz refresh rate.
4. **Manga/Novel Reader Layouts**:
   - **Manga Reader**: Provides horizontal paginated slide views with GSAP transitions and continuous vertical scroll strip listings (Web), as well as multi-touch zoom and panning views (Flutter).
   - **Novel Reader**: Includes immersive Zen-mode typography controllers (sepia, dark obsidian, mint, and light themes) and text scaling custom parameters, drawing design layouts and annotations from **Readest** and **LNReader**.

---

## Monorepo Project Structure

This project is configured as a Turborepo monorepo managed with `pnpm` workspaces:

```
Titanhub/
├── apps/
│   ├── mobile/                  # Flutter Mobile & Desktop Client
│   └── web/                     # Next.js 15 Web Frontend (Tailwind CSS v4 + GSAP)
├── server/                      # Hono API Backend (Bun Runtime)
├── packages/
│   └── plugin-types/            # Shared TypeScript Interfaces for Plugins
├── docs/                        # Specifications and design documents
└── docker-compose.yml           # Local dev database services (Postgres, Redis, MinIO)
```

## Prerequisites

- **Bun** (>= 1.0)
- **Node.js** (>= 20) & **pnpm** (>= 9.0)
- **Flutter** (>= 3.x) & Dart SDK
- **Docker & Docker Compose** (for database services)

## Getting Started

### 1. Database Setup

Spin up the local PostgreSQL instance (Redis and MinIO are reserved for future storage/caching extensions and commented out by default to minimize local resource footprint):

```bash
docker compose up -d
```

### 2. Install Workspace Dependencies

At the workspace root, run:

```bash
pnpm install
```

### 3. Run Development Servers

Start the Next.js frontend (`localhost:3000`) and the Bun/Hono backend (`localhost:3001`) simultaneously:

```bash
pnpm run dev
```

### 4. Run Flutter Client

Navigate to `apps/mobile` and run:

```bash
flutter run
```

---

## Shared Packages

- `@titanhub/plugin-types`: Defines the standard interfaces (`TitanhubPlugin`, `MediaItem`, `Chapter`, etc.) for building and running JS rules safely inside the Web Worker (QuickJS-EMScripten), Dart (`flutter_js`), or Bun engines.
