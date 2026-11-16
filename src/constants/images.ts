import appleLogo from "@/assets/images/apple-logo.svg";
import googleG from "@/assets/images/google-g.svg";
import logoMarkLight from "@/assets/images/logo-mark-light.png";
import logoMark from "@/assets/images/logo-mark.png";
import onboardingScene1 from "@/assets/images/onboarding-scene-1.jpg";
import onboardingScene2 from "@/assets/images/onboarding-scene-2.jpg";
import onboardingScene3 from "@/assets/images/onboarding-scene-3.jpg";
import onboardingScene4 from "@/assets/images/onboarding-scene-4.jpg";
import onboardingScene5 from "@/assets/images/onboarding-scene-5.jpg";
import orbCore from "@/assets/images/orb-core.png";
import orbGlow from "@/assets/images/orb-glow.png";
import orbRibbonLight from "@/assets/images/orb-ribbon-light.png";
import orbRibbonRose from "@/assets/images/orb-ribbon-rose.png";
import orbSheen from "@/assets/images/orb-sheen.png";
import paywallScene1 from "@/assets/images/paywall-scene-1.jpg";
import paywallScene2 from "@/assets/images/paywall-scene-2.jpg";
import playerSceneSquare1 from "@/assets/images/player-scene-1-square.jpg";
import playerScene1 from "@/assets/images/player-scene-1.jpg";
import playerSceneSquare2 from "@/assets/images/player-scene-2-square.jpg";
import playerScene2 from "@/assets/images/player-scene-2.jpg";
import playerSceneSquare3 from "@/assets/images/player-scene-3-square.jpg";
import playerScene3 from "@/assets/images/player-scene-3.jpg";
import playerSceneSquare4 from "@/assets/images/player-scene-4-square.jpg";
import playerScene4 from "@/assets/images/player-scene-4.jpg";
import signInScene1 from "@/assets/images/sign-in-scene-1.jpg";
import signInScene2 from "@/assets/images/sign-in-scene-2.jpg";
import signInScene3 from "@/assets/images/sign-in-scene-3.jpg";
import shareMessages from "@/assets/images/share-messages.svg";
import shareWhatsApp from "@/assets/images/share-whatsapp.svg";
import signInScene4 from "@/assets/images/sign-in-scene-4.jpg";

export const images = {
  // The brand mark (a flame over open hands): plum and rose on transparency, for light surfaces; and its light
  // form, white and rose, for the brand gradient and plum surfaces. Both carry the mark at 72% of a 456 px square.
  logoMark,
  logoMarkLight,
  googleG,
  appleLogo,
  // The share panel's app tiles (2026-11-16): each brand's colour as a 56-point circle with its mark in white, like the apps'
  // own icons, so people recognise them at once. WhatsApp's mark and Messages' bubble are Simple Icons glyphs (CC0); brand
  // logos, like Google's G.
  shareWhatsApp,
  shareMessages,
  // The player's four painted scenes (2026-11-02, the user's call: until then the artwork was the brand gradient with the
  // logo mark in a frosted tile, built in code): a person alone with God in an ordinary place, two women and two men of
  // different ages and backgrounds, numbered in the day's order: a woman in her thirties kneeling at her bed at night, a
  // man in his forties on his back steps at first light, a woman in her sixties in an armchair by a window in the morning,
  // a man in his twenties on a park bench in the afternoon. Each comes twice from the same source: a 4:3 crop at the
  // picture's full height (1290 by 968) for the Now Playing card, and a square crop around the person (1024 by 1024) for
  // the lock screen and Control Center. The card opens on the scene of the hour (`getPlayerSceneForHour`), which is also
  // the lock screen's, and drifts through the four while the voice is heard.
  playerScene1,
  playerScene2,
  playerScene3,
  playerScene4,
  playerSceneSquare1,
  playerSceneSquare2,
  playerSceneSquare3,
  playerSceneSquare4,
  // The Welcome step's five painted scenes (2026-11-01), numbered in the order they rotate: a woman in the car at dawn, a
  // man in his fifties at his office desk at the end of the afternoon, a woman on a walk at golden hour, a man at the
  // kitchen table before dawn, and a woman late at night by a window (three women and two men, so the app never reads as
  // women-only). Illustrations the user generated to one style block, cropped to 4:5 and sized 1290 by 1612 (3x of the
  // widest iPhone); the first is the one a quick tap sees, and a hesitating visitor sees a man within seven seconds.
  onboardingScene1,
  onboardingScene2,
  onboardingScene3,
  onboardingScene4,
  onboardingScene5,
  // The cover of the Sign In that ends onboarding (2026-11-01): four more moments, none of them the Welcome's, so the
  // story goes on at the gate: a father on the hallway floor outside his child's door at night, a nurse on the hospital
  // bench after a night shift at first light, a man on the last bus home, and a woman alone in a church pew on a weekday
  // morning (two men and two women, in their forties, twenties, twenties and sixties). Cropped to 4:3 and sized 1290 by
  // 968, because that scene is shorter; the screen draws their order once per launch.
  signInScene1,
  signInScene2,
  signInScene3,
  signInScene4,
  // The Paywall cover's two scenes (2026-11-15): the payoff of Pro, a person listening at an unhurried hour: a woman in her
  // late thirties curled on a sofa by a tall window in the last golden hour of the afternoon, and a man in his fifties at
  // his balcony railing at sunrise, each with over-ear headphones, eyes closed, a small smile. Generated by the owner in
  // Google Flow from the agent's prompts in the Welcome scenes' style block, cropped to 4:3 and sized 1290 by 968 like
  // the Sign In cover's, because that scene is as short; the screen draws one of the two per launch.
  paywallScene1,
  paywallScene2,
  // The voice orb of a live talk with Scholar (2026-11-15): five soft layers drawn from the brand tokens by a script, which
  // the Talk screen composes and moves with the sound (`VoiceOrb`). The core is a plum sphere that deepens to plum-deep at
  // the rim (512); two ribbons of light, rose and a warm champagne (terracotta mixed with glass), each off-centre so a
  // rotation makes it orbit (512); a white sheen at the top-left for the glass look (512); and the rose glow behind the
  // sphere (640, drawn at 1.6 times the sphere). Plain PNGs with no metadata.
  orbCore,
  orbRibbonRose,
  orbRibbonLight,
  orbSheen,
  orbGlow,
};

export const onboardingScenes = [
  onboardingScene1,
  onboardingScene2,
  onboardingScene3,
  onboardingScene4,
  onboardingScene5,
] as const;

export const signInScenes = [signInScene1, signInScene2, signInScene3, signInScene4] as const;

export const paywallScenes = [paywallScene1, paywallScene2] as const;

// The same four scenes in the day's order: the card's 4:3 crops and the lock screen's square crops.
export const playerScenes = [playerScene1, playerScene2, playerScene3, playerScene4] as const;
export const playerSceneSquares = [
  playerSceneSquare1,
  playerSceneSquare2,
  playerSceneSquare3,
  playerSceneSquare4,
] as const;
