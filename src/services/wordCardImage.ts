import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { Fraunces_400Regular_Italic } from "@expo-google-fonts/fraunces/400Regular_Italic";
import { Fraunces_500Medium } from "@expo-google-fonts/fraunces/500Medium";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces/600SemiBold";
import {
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  type SkColor,
  type SkData,
  type SkImage,
  type SkParagraph,
  type SkTypefaceFontProvider,
} from "@shopify/react-native-skia";
import { Asset } from "expo-asset";

import { copy } from "@/constants/copy";
import { images, playerScenes } from "@/constants/images";
import { colors, fonts, gradients } from "@/constants/theme";
import {
  coverFromTop,
  hexToRgba,
  WORD_CARD,
  WORD_PICTURE,
  wordFadeLocations,
  type WordPicture,
  wordPictureFrame,
  wordPictureSize,
} from "@/utils/wordCardLayout";

// The Today tab's word card as a picture (2026-11-20): what Share sends, so the person a verse is shared with sees the card
// itself, the painted scene with the headline, the verse and its reference on it. Skia draws it off the screen, from the same
// scene, fade, fonts and measures as the card (utils/wordCardLayout.ts), at the card's width and the phone's text size, three
// pixels to a point. The card's two buttons are not drawn; the GraceHush lockup stands in their place.
//
// This file loads Skia, whose JavaScript needs its native module the moment it runs, so only wordCardShare.ts loads it, and
// only in a build that has Skia. Nothing here logs, and nothing is kept but the fonts and the mark.

// Skia takes a colour as four floats in a buffer of their own: the native side reads from the buffer's start, so never a view
// into a larger one.
function color(hex: string, alpha = 1): SkColor {
  return Float32Array.of(...hexToRgba(hex, alpha));
}

// The card's own colours: white text (90% for the verse, 85% for the reference) on the plum-deep fade.
const WHITE = color(colors.card);
const VERSE = color(colors.card, 0.9);
const REFERENCE = color(colors.card, 0.85);
const ROSE = color(colors.rose);
const PLUM_DEEP = color(colors.plumDeep);
const FADE = gradients.wordFade.colors.map((stop) => color(stop));

// Each font file under the family name the app's own text uses for it. No font style is ever asked for, so Skia draws the
// file as it is (asked for a bold or an italic it does not find, it would fake one).
const FONT_FILES: readonly (readonly [string, number])[] = [
  [fonts.frauncesMedium, Fraunces_500Medium],
  [fonts.frauncesItalic, Fraunces_400Regular_Italic],
  [fonts.frauncesSemibold, Fraunces_600SemiBold],
  [fonts.dmSemibold, DMSans_600SemiBold],
];

// A bundled file's bytes. In development Metro serves the file and it is saved on the phone first; in a build it is already
// there. A file that cannot be read comes back empty, and what is made from it is null.
async function loadData(module: number): Promise<SkData | null> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (asset.localUri === null) return null;
  return Skia.Data.fromURI(asset.localUri);
}

type Kit = { fonts: SkTypefaceFontProvider; mark: SkImage };

async function loadKit(): Promise<Kit | null> {
  const provider = Skia.TypefaceFontProvider.Make();
  for (const [family, file] of FONT_FILES) {
    const data = await loadData(file);
    const typeface = data === null ? null : Skia.Typeface.MakeFreeTypeFaceFromData(data);
    if (typeface === null) return null;
    provider.registerFont(typeface, family);
  }
  const data = await loadData(images.logoMarkLight);
  const mark = data === null ? null : Skia.Image.MakeImageFromEncoded(data);
  return mark === null ? null : { fonts: provider, mark };
}

// The fonts and the mark are loaded once and kept for the next picture. A failed load is not kept, so the next share tries
// again.
let kit: Promise<Kit | null> | null = null;

function getKit(): Promise<Kit | null> {
  if (kit === null) {
    const loading = loadKit()
      .catch(() => null)
      .then((loaded) => {
        if (loaded === null && kit === loading) kit = null;
        return loaded;
      });
    kit = loading;
  }
  return kit;
}

type TextLook = { family: string; size: number; line: number; color: SkColor };

// One block of text, wrapped to `width`. A line is `line` tall with the letters in its middle, as React Native lays text out.
function paragraph(provider: SkTypefaceFontProvider, text: string, look: TextLook, width: number): SkParagraph {
  const built = Skia.ParagraphBuilder.Make({}, provider)
    .pushStyle({
      color: look.color,
      fontFamilies: [look.family],
      fontSize: look.size,
      heightMultiplier: look.line / look.size,
      halfLeading: true,
    })
    .addText(text)
    .pop()
    .build();
  built.layout(width);
  return built;
}

// "GraceHush" as the header draws it, two tones in one line, in the light form the launch screen uses on plum-deep.
function brandName(provider: SkTypefaceFontProvider, width: number): SkParagraph {
  const { size, line, tracking } = WORD_PICTURE.brand;
  const look = {
    fontFamilies: [fonts.frauncesSemibold],
    fontSize: size,
    heightMultiplier: line / size,
    halfLeading: true,
    letterSpacing: tracking,
  };
  const built = Skia.ParagraphBuilder.Make({ maxLines: 1 }, provider)
    .pushStyle({ ...look, color: WHITE })
    .addText(copy.header.wordmark.grace)
    .pop()
    .pushStyle({ ...look, color: ROSE })
    .addText(copy.header.wordmark.hush)
    .pop()
    .build();
  built.layout(width);
  return built;
}

function draw(picture: WordPicture, { fonts: provider, mark }: Kit, scene: SkImage): string | null {
  const { width, fontScale, textWidth } = wordPictureSize(picture);
  const { brand, scale, quality } = WORD_PICTURE;
  const sized = (look: { size: number; line: number }) => ({ size: look.size * fontScale, line: look.line * fontScale });

  // Measure first: the card is as tall as its text needs, and at least 280.
  const headline = paragraph(
    provider,
    picture.headline,
    { family: fonts.frauncesMedium, color: WHITE, ...sized(WORD_CARD.headline) },
    textWidth,
  );
  const detail = paragraph(
    provider,
    picture.detail,
    { family: fonts.frauncesItalic, color: VERSE, ...sized(WORD_CARD.detail) },
    textWidth,
  );
  const name = brandName(provider, textWidth);
  const nameWidth = Math.ceil(name.getLongestLine());
  const lockupWidth = brand.mark + brand.gap + nameWidth;
  const reference = paragraph(
    provider,
    picture.reference,
    { family: fonts.dmSemibold, color: REFERENCE, ...sized(WORD_CARD.reference) },
    textWidth - lockupWidth - brand.clearance,
  );
  const frame = wordPictureFrame(width, {
    headline: headline.getHeight(),
    detail: detail.getHeight(),
    reference: reference.getHeight(),
  });

  const surface = Skia.Surface.Make(frame.pixelWidth, frame.pixelHeight);
  if (surface === null) return null;
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  const whole = Skia.XYWHRect(0, 0, frame.width, frame.height);

  // The card, from the back: plum-deep, the scene covering it from its top edge, then the fade the text sits on, pinned to
  // points as the card's is (wordFadeLocations).
  canvas.drawColor(PLUM_DEEP);
  const cut = coverFromTop({ width: scene.width(), height: scene.height() }, frame);
  canvas.drawImageRectOptions(
    scene,
    Skia.XYWHRect(cut.x, cut.y, cut.width, cut.height),
    whole,
    FilterMode.Linear,
    MipmapMode.None,
    Skia.Paint(),
  );
  const fade = Skia.Paint();
  fade.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(0, 0),
      Skia.Point(0, frame.height),
      FADE,
      wordFadeLocations(frame.height, gradients.wordFade.locations),
      TileMode.Clamp,
    ),
  );
  canvas.drawRect(whole, fade);

  headline.paint(canvas, frame.textLeft, frame.headlineTop);
  detail.paint(canvas, frame.textLeft, frame.detailTop);

  // The foot row: the reference at the left and the lockup at the right, each centred on the row.
  const inRow = (height: number) => frame.footTop + (frame.footHeight - height) / 2;
  reference.paint(canvas, frame.textLeft, inRow(reference.getHeight()));
  const lockupLeft = frame.textLeft + frame.textWidth - lockupWidth;
  // The mark is drawn at a sixth of its size, so it is sampled through its smaller copies.
  canvas.drawImageRectOptions(
    mark,
    Skia.XYWHRect(0, 0, mark.width(), mark.height()),
    Skia.XYWHRect(lockupLeft, inRow(brand.mark), brand.mark, brand.mark),
    FilterMode.Linear,
    MipmapMode.Linear,
    Skia.Paint(),
  );
  name.paint(canvas, lockupLeft + brand.mark + brand.gap, inRow(name.getHeight()));

  const base64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, quality);
  return base64 === "" ? null : base64;
}

// The card as a JPEG, in base64, or null when it could not be drawn (a font, the mark or the scene could not be read, or the
// picture could not be made). It may throw: the caller treats that as null too.
export async function renderWordPicture(picture: WordPicture): Promise<string | null> {
  const loaded = await getKit();
  if (loaded === null) return null;
  const data = await loadData(playerScenes[picture.scene] ?? playerScenes[0]);
  const scene = data === null ? null : Skia.Image.MakeImageFromEncoded(data);
  if (scene === null) return null;
  return draw(picture, loaded, scene);
}
