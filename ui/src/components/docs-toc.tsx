import { useEffect, useState } from "react";
import type { DocHeading } from "@/lib/docs";
import { cn } from "@/lib/utils";

/**
 * Highlights the heading the reader is currently under. A heading counts as current once it
 * reaches the top band of the viewport, so the entry changes as a section scrolls into place
 * rather than only when its first line is centred.
 */
function useActiveHeading(headings: DocHeading[]): string | null {
  const [activeSlug, setActiveSlug] = useState<string | null>(headings[0]?.slug ?? null);

  useEffect(() => {
    if (headings.length === 0) return;

    const elements = headings
      .map(({ slug }) => document.getElementById(slug))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const update = () => {
      // The last heading whose top is above the band is the section being read.
      const band = 120;
      let current = elements[0];
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= band) current = element;
      }

      // At the very bottom the last section may be too short to reach the band.
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      setActiveSlug(atBottom ? (elements.at(-1)?.id ?? current.id) : current.id);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [headings]);

  return activeSlug;
}

export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const activeSlug = useActiveHeading(headings);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="space-y-1">
      <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">On this page</p>
      {headings.map(({ slug, text, depth }) => (
        <a
          key={slug}
          href={`#${slug}`}
          className={cn(
            "block border-l py-1.5 pr-2 text-sm leading-snug transition-colors",
            depth === 3 ? "pl-6" : "pl-3",
            slug === activeSlug
              ? "border-foreground font-medium text-foreground"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
          )}
        >
          {text}
        </a>
      ))}
    </nav>
  );
}
