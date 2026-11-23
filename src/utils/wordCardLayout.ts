// The Today tab's word card, in numbers (2026-11-20). The card on the screen (components/today/WordCard.tsx) and the picture of
// it that Share sends (services/wordCardImage.ts) both read them, so the two cannot drift apart. Pure: no React and no native
// module, so the checks run it in Node.

// The card. Sizes are points at the default text size; the text follows the phone's text size, the spacing does not.
export const WORD_CARD = {
  // The card is at least this tall (240 until 2026-11-17), so more of the painting shows above the text. The text is
  // bottom-aligned: a short verse sits lower on a denser part of the fade, and the longest verse fills the card.
  minHeight: 280,
  // The top of the card keeps the hour's painted scene clear, where the face is; the text starts under it.
  sceneRoom: 112,
  sidePadding: 20,
  // Between the headline and the verse.
  detailGap: 8,
  // The foot row (the reference beside two 44-point buttons) and the air under it.
  footHeight: 44,
  footPadding: 8,
  headline: { size: 24, line: 30 },
  detail: { size: 15, line: 22 },
  reference: { size: 13, line: 18 },
} as const;

// The picture of the card.
export const WORD_PICTURE = {
  // Pixels per point: the picture of a 374-point card is 1,122 pixels wide.
  scale: 3,
  // JPEG quality, out of 100.
  quality: 92,
  // The card's width on the narrowest and the widest iPhone, with a little room either side, and the width used when the
  // screen gives none.
  minWidth: 280,
  maxWidth: 440,
  defaultWidth: 350,
  // iOS's standard text sizes run from 0.82 to 1.35. An accessibility size is drawn at the largest standard one, so the
  // picture stays a card and does not become a page.
  minFontScale: 0.82,
  maxFontScale: 1.36,
  // The brand lockup at the foot, where the card on the screen has its Share and heart buttons: the light mark in a 26-point
  // box (the mark itself is 72% of it) beside "GraceHush" in the header wordmark's face, at the header's own proportions
  // (a 40 box, a 6 gap and 22-point letters with -2.5% tracking there). It does not follow the text size. The reference
  // keeps 12 points clear of it.
  brand: { mark: 26, gap: 4, size: 14, line: 18, tracking: -0.35, clearance: 12 },
  // Apple's App Store badge at the top left (2026-11-23, the lead's mock-up): Apple's own black "Download on the App Store"
  // artwork, unaltered, 14 points tall (42 pixels, over the 40 Apple asks for on a screen), its top 12 points down and its left
  // on the text's 20 of padding. Apple asks for clear space of a quarter of its height; the scene's room keeps the words far
  // below it. It does not follow the text size. No other store's badge (App Review Guideline 2.3.10; GraceHush is not on Google
  // Play).
  storeBadge: { height: 14, top: 12 },
} as const;

export type WordPicture = {
  headline: string;
  // The verse as the card shows it: in curly quotes, as one flowing paragraph.
  detail: string;
  // The line at the foot: "Psalm 4:8 · BSB".
  reference: string;
  // An index into images.playerScenes: the scene the card shows.
  scene: number;
  // The card's width on this phone, in points, and the phone's text size (1 is the default).
  width: number;
  fontScale: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// The picture's width in whole points and its text scale, each kept inside what an iPhone shows.
export function wordPictureSize(picture: Pick<WordPicture, "width" | "fontScale">): {
  width: number;
  fontScale: number;
  textWidth: number;
} {
  const { minWidth, maxWidth, defaultWidth, minFontScale, maxFontScale } = WORD_PICTURE;
  const width = Math.round(clamp(Number.isFinite(picture.width) ? picture.width : defaultWidth, minWidth, maxWidth));
  const fontScale = clamp(Number.isFinite(picture.fontScale) ? picture.fontScale : 1, minFontScale, maxFontScale);
  return { width, fontScale, textWidth: width - 2 * WORD_CARD.sidePadding };
}

export type WordPictureFrame = {
  // The picture in points and in pixels. The height is a whole number of pixels, so it can be a little over the card's own.
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  // The text column.
  textLeft: number;
  textWidth: number;
  // Where each piece starts, from the top. The foot row is as tall as the card's buttons, or as the reference when it wraps.
  headlineTop: number;
  detailTop: number;
  footTop: number;
  footHeight: number;
};

// Where everything sits once the text has been measured: the card's own layout. The scene room, the headline, the verse and
// the foot row are stacked and pushed to the bottom of a card that is at least 280 tall.
export function wordPictureFrame(
  width: number,
  heights: { headline: number; detail: number; reference: number },
): WordPictureFrame {
  const { scale } = WORD_PICTURE;
  const { sceneRoom, detailGap, footPadding, sidePadding, minHeight } = WORD_CARD;
  const footHeight = Math.max(WORD_CARD.footHeight, heights.reference);
  const content = sceneRoom + heights.headline + detailGap + heights.detail + footHeight + footPadding;
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.ceil(Math.max(minHeight, content) * scale);
  const height = pixelHeight / scale;
  const footTop = height - footPadding - footHeight;
  const detailTop = footTop - heights.detail;
  const headlineTop = detailTop - detailGap - heights.headline;
  return {
    width: pixelWidth / scale,
    height,
    pixelWidth,
    pixelHeight,
    textLeft: sidePadding,
    textWidth: pixelWidth / scale - 2 * sidePadding,
    headlineTop,
    detailTop,
    footTop,
    footHeight,
  };
}

// The part of an image that covers a box when it is anchored at its top edge and centred sideways, as the card's scene is
// (contentFit "cover", contentPosition "top"): never stretched, the overflow cut from the sides or from the bottom.
export function coverFromTop(
  image: { width: number; height: number },
  box: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const fit = Math.max(box.width / image.width, box.height / image.height);
  const width = box.width / fit;
  const height = box.height / fit;
  return { x: (image.width - width) / 2, y: 0, width, height };
}

// The fade the text sits on (theme.ts gradients.wordFade), pinned to points (2026-11-21). Its stops are fractions of a card of
// minHeight, and on a taller card (a long verse at a large text size, or a card the deck draws taller) each stop between the
// two ends keeps its distance from the top in points, so the fade is as dense from the scene room down whatever the card's
// height. Stretched with the card, it had put a tall card's headline on the clear part of the scene: on the dawn scene at text
// size 1.35, a median contrast of 3.81 under the headline's first line and 1.48 on its lightest 5%. On a card of minHeight
// (or less) the stops are the theme's own.
export function wordFadeLocations(
  height: number,
  locations: readonly [number, number, ...number[]],
): [number, number, ...number[]] {
  const scale = Number.isFinite(height) && height > WORD_CARD.minHeight ? WORD_CARD.minHeight / height : 1;
  const last = locations.length - 1;
  const pin = (stop: number, index: number) => (index === 0 || index === last ? stop : stop * scale);
  const [first, second, ...rest] = locations;
  return [pin(first, 0), pin(second, 1), ...rest.map((stop, index) => pin(stop, index + 2))];
}

// A theme colour ("#3E2741", or "#3E2741B8" with its alpha) as red, green, blue and alpha between 0 and 1, the form Skia
// takes a colour in. `alpha` multiplies the colour's own. Anything that is not such a colour is opaque black.
export function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (match === null) return [0, 0, 0, 1];
  const channel = (value: string) => parseInt(value, 16) / 255;
  const own = match[4] === undefined ? 1 : channel(match[4]);
  return [channel(match[1]), channel(match[2]), channel(match[3]), own * alpha];
}

// The picture's file name, which the share sheet shows and Files and Mail keep: "GraceHush-Psalm-4-8-BSB.jpg".
export function wordPictureFileName(reference: string): string {
  const slug = reference
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `GraceHush-${slug === "" ? "verse" : slug}.jpg`;
}
