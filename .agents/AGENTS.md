# Titanhub Project Rules

## 1. Next.js Server-Side Rendering (SSR) Guardrails

- **Browser-Only Libraries (e.g., hls.js)**: Always import components that consume browser-only libraries or reference global browser objects (`window`, `document`, `navigator`) using Next.js dynamic loading:
  ```typescript
  import dynamic from 'next/dynamic';
  const Component = dynamic(() => import('@/components/Component'), { ssr: false });
  ```
  Statically importing these components at the page level will crash Next.js pre-rendering with a `window is not defined` error.

## 2. QuickJS Sandbox Engine Rules

- **Explicit VM Handle Disposal**: In `quickjs-emscripten`, all handles allocated on the QuickJS virtual machine (such as `newString`, `newObject`, `newNumber`, `newFunction`, and VM promises) must be tracked and explicitly freed via `.dispose()` inside a `finally` block before calling `vm.dispose()`. Failing to dispose of any active handles will cause the WASM runtime to abort the Node/Bun process with an assertion failure (`list_empty(&rt->gc_obj_list)`).
- **QuickJS Constant Handles**: Use the built-in getter properties `vm.null`, `vm.undefined`, `vm.true`, and `vm.false` to reference JavaScript constants instead of calling nonexistent instantiation methods (like `newNull()`). Since these constant handles are managed internally by the quickjs context lifecycle, they do not require manual disposal.

## 3. Custom HTML5 Video Player Rules

- **Dynamic Source Reloading**: When updating the `src` attribute of a custom HTML5 `<video>` element programmatically (especially in React components), always call `video.load()` immediately after to force the browser to trigger its resource selection algorithm. In addition, reset related playback states (like `isPlaying = false`, `currentTime = 0`, `duration = 0`) to prevent UI components from displaying stale duration values.

## 4. Testing Protocols

- **Mandatory Dual-Testing**: After completing any task, always perform:
  1. **Black-Box Test**: Verify functionality from an external user perspective (e.g. running browser subagents, calling public router APIs with mock query parameters, validating UI flows).
  2. **White-Box Test**: Verify implementation correctness from an internal code perspective (e.g. executing typescript compilation checks `pnpm run build`, checking console debug logs, inspecting handle allocation files, running unit tests).

## 5. Ponytail Architecture Principles

- **YAGNI (You Aren't Gonna Need It)**: Deliver the minimal viable version of each module first. Do not add abstractions (e.g., GraphQL, Microservices, extra DTO layers) for "future-proofing".
- **Reusability**: For the Flutter client, heavily reuse established solutions from Kazumi (video player) and Venera (reader) instead of rewriting from scratch.
- **Monolithic & Standard First**: Default to the simplest standard solution (e.g., standard CSS before GSAP, View Transition API before complex routing animations, single PostgreSQL database).

## 6. GSAP & Web Animation Rules

- **GPU Acceleration**: Always use `will-change: transform` and `force3D: true` for elements with frequent layout changes (e.g., Danmaku, hover cards).
- **Cleanup on Unmount**: When using GSAP in React/Next.js components, always keep track of tweens/timelines (e.g., using `gsap.context()` or refs) and explicitly call `.revert()` or `.kill()` on unmount to prevent memory leaks.
- **Progressive Enhancement**: Ensure core functionality and layout work correctly even if JS/GSAP fails to load.

## 7. Pipeline-Driven Architecture & Theming

- **Centralized Design Tokens**: To ensure visual consistency between the Next.js Web Frontend and the Flutter App, avoid hardcoding hex colors or animation variables deeply inside components. Abstract these into a shared `theme` package or token file.
- **Asynchronous Scraping Pipelines**: Design backend plugins and data scrapers to be triggerable via asynchronous Webhooks or background cron jobs. Heavy aggregation tasks should never block synchronous client requests.
- **Graceful Fallbacks & Caching**: Always implement aggressive caching or alternative plugin nodes if a primary content source fails (similar to local offline fallbacks), ensuring the user never faces a blank screen.

## 8. Backend (Hono & Drizzle ORM) Guardrails

- **Hono Context Variables Type-Safety**: Always define a typed `Env` parameter containing `Variables` when instantiating Hono route groups or app instances (e.g., `const sync = new Hono<{ Variables: { userId: string } }>()`). Ensure middleware and route handlers use `Context<Env>` for context parameter typing. This prevents `c.get('userId')` from resolving to `never` or `unknown`, avoiding type assignment errors during Drizzle ORM queries and insert operations.

## 9. Tailwind CSS v4 Editor Config

- **Tailwind CSS v4 CSS Validation**: Tailwind CSS v4 introduces custom CSS directives (e.g., `@config`, `@theme`, `@utility`). To prevent IDEs from reporting "Unknown at rule" syntax warnings, maintain `.vscode/settings.json` in the workspace root with:
  ```json
  {
    "css.lint.unknownAtRules": "ignore"
  }
  ```
