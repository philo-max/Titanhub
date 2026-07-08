'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/dist/ScrollTrigger';

// Register plugins safely on the client side
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

/**
 * Parallax scroll effect with staggered text entrance for the HeroBanner.
 */
export function animateParallaxScroll(
  container: HTMLElement | null,
  background: HTMLElement | null,
  textContainer: HTMLElement | null
) {
  if (!container) return null;

  const ctx = gsap.context(() => {
    if (background) {
      gsap.to(background, {
        scale: 1.15,
        y: 60,
        ease: 'none',
        scrollTrigger: {
          trigger: container,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      });
    }

    if (textContainer && textContainer.children) {
      gsap.from(textContainer.children, {
        y: 40,
        opacity: 0,
        duration: 1.2,
        stagger: 0.15,
        ease: 'power3.out',
        delay: 0.3,
        // Without this, immediateRender applies the "from" state (opacity:0) the
        // instant the tween is created, so once the delay elapses GSAP captures
        // that same opacity:0 as the implicit "to" target and the tween animates
        // 0 -> 0, leaving the element permanently invisible.
        immediateRender: false,
      });
    }
  }, container);

  return ctx;
}

/**
 * 3D Hover Tilt Effect for MediaCard.
 */
export function animateCardHoverTilt(
  card: HTMLElement | null,
  image: HTMLElement | null,
  clientX: number,
  clientY: number
) {
  if (!card || !image) return;

  const rect = card.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const xPct = (x / rect.width - 0.5) * 2;
  const yPct = (y / rect.height - 0.5) * 2;

  gsap.to(card, {
    rotateY: xPct * 10,
    rotateX: -yPct * 10,
    duration: 0.3,
    ease: 'power2.out',
    transformPerspective: 1000,
    force3D: true,
  });

  gsap.to(image, {
    x: -xPct * 5,
    y: -yPct * 5,
    duration: 0.3,
    ease: 'power2.out',
  });
}

/**
 * Reset 3D Hover Tilt for MediaCard.
 */
export function resetCardHoverTilt(card: HTMLElement | null, image: HTMLElement | null) {
  if (!card || !image) return;

  gsap.to([card, image], {
    rotateY: 0,
    rotateX: 0,
    x: 0,
    y: 0,
    duration: 0.5,
    ease: 'elastic.out(1, 0.5)',
  });
}

/**
 * Entrance fade-in and slide-up stagger animation with ScrollTrigger batching.
 */
export function animateEntranceStagger(
  container: HTMLElement | null,
  cardSelector: string = '.media-card-wrapper'
) {
  if (!container) return null;

  const ctx = gsap.context(() => {
    const cards = gsap.utils.toArray<HTMLElement>(cardSelector);
    gsap.set(cards, { y: 80, opacity: 0 });

    ScrollTrigger.batch(cards, {
      onEnter: (elements) => {
        gsap.to(elements, {
          y: 0,
          opacity: 1,
          stagger: 0.08,
          duration: 0.8,
          ease: 'back.out(1.2)',
          force3D: true,
        });
      },
      once: true,
    });
  }, container);

  return ctx;
}

/**
 * Smooth transition for a horizontal category tab background indicator.
 */
export function animateCategoryTabIndicator(
  indicator: HTMLElement | null,
  activeTab: HTMLElement | null
) {
  if (!indicator || !activeTab) return;

  gsap.to(indicator, {
    x: activeTab.offsetLeft,
    width: activeTab.offsetWidth,
    duration: 0.4,
    ease: 'power3.out',
    force3D: true,
  });
}

/**
 * Counter counting animation from '0' to the target index.
 */
export function animateCounter(
  element: HTMLElement | null,
  targetNumber: number,
  delay: number = 0
) {
  if (!element) return;

  gsap.fromTo(
    element,
    { textContent: '0' },
    {
      textContent: targetNumber,
      duration: 1.5,
      ease: 'power2.out',
      snap: { textContent: 1 },
      delay: delay,
    }
  );
}

/**
 * Scale-in and fade-in modal open transition.
 */
export function animateModalOpen(overlay: HTMLElement | null, modal: HTMLElement | null) {
  if (overlay) {
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
  }
  if (modal) {
    gsap.fromTo(
      modal,
      { opacity: 0, y: 50, scale: 0.95 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.5)' }
    );
  }
}

/**
 * Fade-out and slide-down modal close transition.
 */
export function animateModalClose(
  overlay: HTMLElement | null,
  modal: HTMLElement | null,
  onComplete: () => void
) {
  if (overlay) {
    gsap.to(overlay, { opacity: 0, duration: 0.2 });
  }
  if (modal) {
    gsap.to(modal, {
      opacity: 0,
      y: 20,
      scale: 0.95,
      duration: 0.2,
      onComplete: onComplete,
    });
  } else {
    onComplete();
  }
}

/**
 * Slide-in / slide-out visibility transition for the video player control bar.
 */
export function animateControlsVisibility(controls: HTMLElement | null, visible: boolean) {
  if (!controls) return;

  gsap.to(
    controls,
    visible
      ? { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }
      : { opacity: 0, y: 10, duration: 0.4, ease: 'power2.in' }
  );
}

/**
 * Horizontal right-to-left travel tween for a single danmaku comment element.
 * Returns the tween so the caller can pause/resume/kill it with playback state.
 */
export type DanmakuTween = gsap.core.Tween;

export function animateDanmakuTravel(
  el: HTMLElement,
  travelDistance: number,
  duration: number,
  paused: boolean,
  onComplete: () => void
): gsap.core.Tween {
  return gsap.to(el, {
    x: -travelDistance,
    duration,
    ease: 'linear',
    paused,
    force3D: true,
    onComplete,
  });
}

/**
 * Shakes the element on input errors.
 */
export function animateShake(element: HTMLElement | null) {
  if (!element) return;

  gsap.fromTo(
    element,
    { x: -10 },
    {
      x: 10,
      duration: 0.1,
      yoyo: true,
      repeat: 3,
      onComplete: () => gsap.set(element, { x: 0 }),
    }
  );
}

/**
 * Staggered entrance fade-in and scale-in for Detail pages.
 */
export function animateDetailPageEntrance(container: HTMLElement | null) {
  if (!container) return null;

  const ctx = gsap.context(() => {
    gsap.from('.animate-fade-in', {
      opacity: 0,
      y: 20,
      duration: 0.6,
      stagger: 0.1,
      ease: 'power2.out',
    });

    gsap.from('.animate-scale-in', {
      scale: 0.95,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out',
    });

    gsap.from('.animate-chapter-btn', {
      scale: 0.9,
      opacity: 0,
      duration: 0.5,
      stagger: 0.03,
      delay: 0.3,
      ease: 'back.out(1.2)',
      // See animateParallaxScroll for why this is required alongside delay.
      immediateRender: false,
    });
  }, container);

  return ctx;
}

/**
 * Slide left and fade out exit animation for back transitions on detail pages.
 */
export function animateDetailPageExitBack(container: HTMLElement | null, onComplete: () => void) {
  if (!container) {
    onComplete();
    return;
  }
  gsap.to(container, {
    opacity: 0,
    x: -30,
    duration: 0.3,
    onComplete,
  });
}

/**
 * Scale down and fade out exit animation when a chapter is clicked on detail pages.
 */
export function animateDetailPageExitPlay(container: HTMLElement | null, onComplete: () => void) {
  if (!container) {
    onComplete();
    return;
  }
  gsap.to(container, {
    opacity: 0,
    scale: 0.98,
    duration: 0.3,
    onComplete,
  });
}

/**
 * Staggered entrance fade-in and slide-up for play pages.
 */
export function animatePlayPageEntrance(container: HTMLElement | null) {
  if (!container) return null;

  const ctx = gsap.context(() => {
    gsap.from('.animate-fade-play', {
      opacity: 0,
      y: 30,
      duration: 0.8,
      stagger: 0.1,
      ease: 'power3.out',
    });
  }, container);

  return ctx;
}

/**
 * Scale down and fade out exit animation when next chapter is clicked on play pages.
 */
export function animatePlayPageExitNext(container: HTMLElement | null, onComplete: () => void) {
  if (!container) {
    onComplete();
    return;
  }
  gsap.to(container, {
    opacity: 0,
    scale: 0.98,
    duration: 0.3,
    onComplete,
  });
}

/**
 * Slide right and fade out exit animation when back button is clicked on play pages.
 */
export function animatePlayPageExitBack(container: HTMLElement | null, onComplete: () => void) {
  if (!container) {
    onComplete();
    return;
  }
  gsap.to(container, {
    opacity: 0,
    x: 30,
    duration: 0.3,
    onComplete,
  });
}

/**
 * Horizontal slide & fade page transitions for Manga reader.
 */
export function animateMangaPageTransition(
  prevTarget: string,
  target: string,
  isNext: boolean,
  container: HTMLElement | null
) {
  if (!container) return null;

  const ctx = gsap.context(() => {
    // Hide previous page
    gsap.set(prevTarget, { display: 'none' });

    // Slide in new page
    gsap.fromTo(
      target,
      {
        opacity: 0,
        x: isNext ? 100 : -100,
      },
      {
        opacity: 1,
        x: 0,
        duration: 0.4,
        display: 'block',
        ease: 'power2.out',
      }
    );
  }, container);

  return ctx;
}

/**
 * Animates the horizontal scroll progress bar in novel reader.
 */
export function animateScrollProgress(indicator: HTMLElement | null, percent: number) {
  if (!indicator) return;
  gsap.to(indicator, {
    width: `${percent}%`,
    duration: 0.1,
    overwrite: 'auto',
    ease: 'none',
  });
}

/**
 * Stagger reveal animation for novel paragraphs.
 */
export function animateNovelParagraphsReveal(
  container: HTMLElement | null,
  paragraphSelector: string = '.animate-paragraph'
) {
  if (!container) return null;

  const ctx = gsap.context(() => {
    gsap.fromTo(
      paragraphSelector,
      {
        opacity: 0,
        y: 15,
      },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.05,
        ease: 'power2.out',
      }
    );
  }, container);

  return ctx;
}
