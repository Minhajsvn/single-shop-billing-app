"use client";

import { useEffect } from "react";

// Section entrances and in-view video playback for the home page. Content is visible without script:
// the hidden start state only applies once this sets data-motion on the root.
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".landing");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) root.dataset.motion = "on";

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          reveal.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));

    const videos = root.querySelectorAll<HTMLVideoElement>("video[data-autoplay]");
    const play = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting && !reduce) video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0.35 },
    );
    videos.forEach((video) => play.observe(video));

    // The phone's sticky trial bar shows once the hero's button has scrolled away, and hides at the closing call to action.
    const hero = root.querySelector(".lp-hero");
    const close = root.querySelector(".lp-close");
    let heroVisible = true;
    let closeVisible = false;
    const sticky = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) heroVisible = entry.isIntersecting;
        if (entry.target === close) closeVisible = entry.isIntersecting;
      }
      root.classList.toggle("show-sticky", !heroVisible && !closeVisible);
    });
    if (hero) sticky.observe(hero);
    if (close) sticky.observe(close);

    return () => {
      reveal.disconnect();
      play.disconnect();
      sticky.disconnect();
    };
  }, []);

  return null;
}
