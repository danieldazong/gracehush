// The launch screen's "from Nouvrix" footer, as WhatsApp shows "from Meta": the parent company's logo under the
// word "from", centred near the bottom of the iOS launch screen. The art is assets/images/splash-footer.png with its
// @2x and @3x (95 x 45 points: "from" in DM Sans Regular 15 at 60% linen over the logo in linen, 18 points tall,
// with 2 points of transparent margin). The same storyboard is the view expo-splash-screen holds while the app
// loads, so the footer stays until the launch screen fades into the first screen.
//
// List this plugin BEFORE "expo-splash-screen" in app.json. Mods on the launch storyboard run in the reverse of the
// order they are added, and the splash plugin's own mod clears every constraint and every image of the storyboard
// before it places the lockup; listed first, this one runs after it and adds the footer to the finished storyboard.
// Listed after it, prebuild stops with INVALID_MOD_ORDER, because the splash plugin adds the storyboard's provider
// last and no mod may be added after a provider.
//
// iOS only: Android's launch screen is left as it is (Android work waits for the App Store release).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { IOSConfig, withDangerousMod, withMod } = require("expo/config-plugins");

const IMAGE_NAME = "SplashScreenFooter";
const VIEW_ID = "GRACEHUSH-SplashFooter";
const CONTAINER_ID = "EXPO-ContainerView";
const SOURCE = "assets/images/splash-footer";
const SCALES = [
  ["", "1x"],
  ["@2x", "2x"],
  ["@3x", "3x"],
];
const WIDTH = 95;
const HEIGHT = 45;
// The image's bottom edge sits 36 points above the bottom of the safe area, so the logo itself (2 points of margin
// higher) ends 38 points above it, where WhatsApp's "Meta" ends on an iPhone XR.
const BOTTOM_GAP = 36;

function stableId(...parts) {
  return crypto.createHash("sha1").update(["gracehush-splash-footer", ...parts].join("-")).digest("hex");
}

function withoutId(items, id) {
  return (items ?? []).filter((item) => item?.$?.id !== id);
}

// Adds the footer's image view, its four constraints and its image resource to the launch storyboard (xml2js form).
function addFooter(xml) {
  const view = xml?.document?.scenes?.[0]?.scene?.[0]?.objects?.[0]?.viewController?.[0]?.view?.[0];
  const resources = xml?.document?.resources?.[0];
  if (!view || view.$?.id !== CONTAINER_ID || !resources) {
    throw new Error(
      "withSplashFooter: the launch storyboard is not the shape expo-splash-screen writes, so the footer cannot be placed.",
    );
  }

  const safeArea = (view.viewLayoutGuide ?? []).find((guide) => guide?.$?.key === "safeArea");
  if (!safeArea?.$?.id) {
    throw new Error("withSplashFooter: the launch storyboard has no safe area layout guide to anchor the footer to.");
  }

  const canvasWidth = Number(view.rect?.[0]?.$?.width ?? 393);
  const canvasHeight = Number(view.rect?.[0]?.$?.height ?? 852);
  const imageView = {
    $: {
      id: VIEW_ID,
      userLabel: IMAGE_NAME,
      image: IMAGE_NAME,
      contentMode: "scaleAspectFit",
      clipsSubviews: "YES",
      userInteractionEnabled: "NO",
      translatesAutoresizingMaskIntoConstraints: "NO",
    },
    // Where Interface Builder draws it on its 393 x 852 canvas (a 34-point home indicator inset); constraints decide at run time.
    rect: [
      {
        $: {
          key: "frame",
          x: (canvasWidth - WIDTH) / 2,
          y: canvasHeight - 34 - BOTTOM_GAP - HEIGHT,
          width: WIDTH,
          height: HEIGHT,
        },
      },
    ],
    constraints: [
      {
        constraint: [
          { $: { firstAttribute: "width", constant: WIDTH, id: stableId("width") } },
          { $: { firstAttribute: "height", constant: HEIGHT, id: stableId("height") } },
        ],
      },
    ],
  };

  // xml2js reads an empty element as "", so make sure each list's holder is an object before adding to it.
  if (typeof view.subviews?.[0] !== "object") view.subviews = [{}];
  view.subviews[0].imageView = [...withoutId(view.subviews[0].imageView, VIEW_ID), imageView];

  const centerX = stableId("centerX");
  const bottom = stableId("bottom");
  if (typeof view.constraints?.[0] !== "object") view.constraints = [{}];
  view.constraints[0].constraint = [
    ...withoutId(withoutId(view.constraints[0].constraint, centerX), bottom),
    {
      $: {
        firstItem: VIEW_ID,
        firstAttribute: "centerX",
        secondItem: CONTAINER_ID,
        secondAttribute: "centerX",
        id: centerX,
      },
    },
    {
      // safe area bottom = footer bottom + BOTTOM_GAP
      $: {
        firstItem: safeArea.$.id,
        firstAttribute: "bottom",
        secondItem: VIEW_ID,
        secondAttribute: "bottom",
        constant: BOTTOM_GAP,
        id: bottom,
      },
    },
  ];

  resources.image = [
    ...(resources.image ?? []).filter((image) => image?.$?.name !== IMAGE_NAME),
    { $: { name: IMAGE_NAME, width: WIDTH, height: HEIGHT } },
  ];
  return xml;
}

function withFooterStoryboard(config) {
  return withMod(config, {
    platform: "ios",
    mod: "splashScreenStoryboard",
    action: (config) => {
      config.modResults = addFooter(config.modResults);
      return config;
    },
  });
}

// Copies the three renders into the asset catalog as the SplashScreenFooter image set.
function withFooterImageSet(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const { projectRoot } = config.modRequest;
      const imageSet = path.join(IOSConfig.Paths.getSourceRoot(projectRoot), "Images.xcassets", `${IMAGE_NAME}.imageset`);
      await fs.promises.rm(imageSet, { recursive: true, force: true });
      await fs.promises.mkdir(imageSet, { recursive: true });
      for (const [suffix] of SCALES) {
        await fs.promises.copyFile(
          path.join(projectRoot, `${SOURCE}${suffix}.png`),
          path.join(imageSet, `image${suffix}.png`),
        );
      }
      const images = SCALES.map(([suffix, scale]) => ({ idiom: "universal", filename: `image${suffix}.png`, scale }));
      await fs.promises.writeFile(
        path.join(imageSet, "Contents.json"),
        JSON.stringify({ images, info: { version: 1, author: "expo" } }, null, 2),
      );
      return config;
    },
  ]);
}

const withSplashFooter = (config) => withFooterStoryboard(withFooterImageSet(config));

module.exports = withSplashFooter;
module.exports.addFooter = addFooter;
