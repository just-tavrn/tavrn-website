// SPDX-License-Identifier: Apache-2.0
/**
 * Draws the Mermaid diagrams of a docs page (structure: src/lib/mermaid.mjs). Loaded lazily by the loader in
 * src/components/starlight/MarkdownContent.astro, only on pages that have a diagram. Mermaid runs with
 * securityLevel "strict" (labels are sanitized, no click handlers), in the colours of the site's tokens and with
 * the self-hosted Inter; it makes no requests and stores nothing. A diagram that cannot be drawn keeps its source
 * visible with a one-line note.
 */
import mermaid from "mermaid";
import tokensCss from "../styles/tokens.css?raw";

/** A colour of src/styles/tokens.css. */
function token(name: string, fallback: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(tokensCss);
  return m?.[1] ?? fallback;
}

const FONT = '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
let initialized = false;
let counter = 0;

function initialize(): void {
  if (initialized) return;
  initialized = true;
  const fg0 = token("fg-0", "#f3f4f6");
  const fg2 = token("fg-2", "#8a92a2");
  const bg1 = token("bg-1", "#161920");
  const bg2 = token("bg-2", "#1d2129");
  const bg3 = token("bg-3", "#262b35");
  const lineStrong = token("line-strong", "#737b8c");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    darkMode: true,
    fontFamily: FONT,
    // Mermaid 12 lays out with ELK by default, a 440 KB (gzipped) chunk; dagre draws these diagrams just as well.
    layout: "dagre",
    look: "classic",
    // Natural size: a wide diagram scrolls inside its frame instead of shrinking to unreadable text on a phone.
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    themeVariables: {
      darkMode: true,
      fontFamily: FONT,
      background: bg1,
      primaryColor: bg3,
      primaryTextColor: fg0,
      primaryBorderColor: lineStrong,
      secondaryColor: bg2,
      tertiaryColor: token("bg-0", "#0f1115"),
      lineColor: fg2,
      textColor: fg0,
      mainBkg: bg3,
      nodeBorder: lineStrong,
      clusterBkg: bg2,
      clusterBorder: lineStrong,
      edgeLabelBackground: bg1,
      actorBkg: bg3,
      actorBorder: lineStrong,
      actorTextColor: fg0,
      actorLineColor: fg2,
      signalColor: fg0,
      signalTextColor: fg0,
      labelBoxBkgColor: bg3,
      labelBoxBorderColor: lineStrong,
      labelTextColor: fg0,
      loopTextColor: fg0,
      noteBkgColor: bg2,
      noteBorderColor: lineStrong,
      noteTextColor: fg0,
    },
  });
}

/** Shrinks a diagram wider than its frame, down to MIN_SCALE (half size still reads on a desktop column; the labels
 * are 14 px in the natural size); what is still wider, mostly on phones, scrolls inside the frame. */
const MIN_SCALE = 0.5;

function fit(frame: HTMLElement, drawing: SVGSVGElement, natural: number): void {
  const style = getComputedStyle(frame);
  const available = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const width = natural <= available ? natural : Math.max(available, natural * MIN_SCALE);
  drawing.style.width = `${Math.round(width)}px`;
  drawing.style.maxWidth = "none";
  drawing.style.height = "auto";
  markScrollable(frame);
}

/** Makes a frame that scrolls sideways reachable with the keyboard. */
function markScrollable(frame: HTMLElement): void {
  const scrolls = frame.scrollWidth > frame.clientWidth + 1;
  if (scrolls) frame.tabIndex = 0;
  else frame.removeAttribute("tabindex");
}

async function draw(container: HTMLElement): Promise<void> {
  const pre = container.querySelector<HTMLElement>("pre.mermaid");
  if (!pre || container.dataset.drawn) return;
  container.dataset.drawn = "pending";
  const source = pre.textContent ?? "";
  const id = `mermaid-diagram-${++counter}`;
  try {
    if ((await mermaid.parse(source, { suppressErrors: true })) === false) throw new Error("invalid diagram");
    const { svg } = await mermaid.render(id, source);
    const frame = document.createElement("div");
    frame.className = "mermaid-frame";
    frame.innerHTML = svg;
    const drawing = frame.querySelector("svg");
    if (!drawing) throw new Error("no drawing");
    drawing.setAttribute("role", "img");
    drawing.setAttribute("aria-label", container.dataset.label ?? "Diagram");
    drawing.removeAttribute("aria-roledescription");
    pre.replaceWith(frame);
    container.dataset.drawn = "true";
    const natural = drawing.viewBox.baseVal?.width || drawing.getBoundingClientRect().width;
    drawing.removeAttribute("width");
    fit(frame, drawing, natural);
    new ResizeObserver(() => fit(frame, drawing, natural)).observe(frame);
  } catch {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    container.dataset.drawn = "failed";
    const note = document.createElement("p");
    note.className = "mermaid-note";
    note.textContent = "This diagram could not be drawn here; its source is shown instead.";
    pre.after(note);
  }
}

/** Draws every diagram of the page, one after the other. */
export async function renderDiagrams(root: ParentNode = document): Promise<void> {
  initialize();
  for (const container of root.querySelectorAll<HTMLElement>(".mermaid-diagram")) await draw(container);
}
